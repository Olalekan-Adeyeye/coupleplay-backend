import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GAME_ENGINES } from './game-registry';
import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
} from './game.types';
import { SpeedBattleState } from './speed-battle/speed-battle.engine';
import { NumberHuntState } from './number-hunt/number-hunt.engine';
import { MemoryMatchState } from './memory-match/memory-match.engine';

export interface ActionOutcome {
  state: GameStateBase;
  endedState: GameStateBase | null;
  changed: boolean;
  roundEnded: boolean;
  roundWinnerId: string | null;
  endedRoundNumber: number | null;
  finished: boolean;
  results: GameResult | null;
}

@Injectable()
export class GameEngineService {
  private readonly logger = new Logger(GameEngineService.name);

  private live = new Map<string, GameStateBase>();

  private locks = new Map<string, Promise<unknown>>();

  constructor(private prisma: PrismaService) {}

  private withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prior = (this.locks.get(roomId) ?? Promise.resolve()).catch(() => {});
    const run = prior.then(fn);
    this.locks.set(roomId, run);
    const release = () => {
      if (this.locks.get(roomId) === run) this.locks.delete(roomId);
    };
    run.then(release, release);

    return run;
  }

  private engineFor(
    gameType: string,
  ): MultiplayerGame<GameStateBase, GameAction> {
    const engine = GAME_ENGINES[gameType];
    if (!engine) throw new Error(`No engine registered for game type ${gameType}`);
    return engine;
  }

  private async engineForRoom(roomId: string) {
    const room = await this.prisma.gameRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new Error('Room not found');
    return this.engineFor(room.gameType);
  }

  async startGame(roomId: string): Promise<GameStateBase> {
    return this.withRoomLock(roomId, () => this.startGameLocked(roomId));
  }

  private async startGameLocked(roomId: string): Promise<GameStateBase> {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
    if (!room) throw new Error('Room not found');
    if (room.players.length < 2) throw new Error('Need both players');

    if (room.status !== 'WAITING') {
      const existing = await this.getCurrentState(roomId);
      if (existing) return existing;
      throw new Error(`Room is ${room.status}, not startable`);
    }

    const engine = this.engineFor(room.gameType);
    const state = engine.createGame(roomId, room.players as any, room.totalRounds);

    await this.prisma.$transaction([
      this.prisma.gameRound.create({
        data: {
          roomId,
          roundNumber: 1,
          state: 'active',
          data: JSON.stringify(state),
          startedAt: new Date(),
        },
      }),
      this.prisma.gameRoom.update({
        where: { id: roomId },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), currentRound: 1 },
      }),
    ]);

    this.live.set(roomId, state);
    return state;
  }

  async getCurrentState(roomId: string): Promise<GameStateBase | null> {
    const cached = this.live.get(roomId);
    if (cached) return cached;

    const round = await this.prisma.gameRound.findFirst({
      where: { roomId, state: 'active' },
      orderBy: { roundNumber: 'desc' },
    });
    if (round?.data) {
      const state = JSON.parse(round.data) as GameStateBase;
      this.live.set(roomId, state);
      return state;
    }
    return null;
  }

  async handleAction(
    roomId: string,
    playerId: string,
    action: GameAction,
  ): Promise<ActionOutcome> {
    return this.withRoomLock(roomId, () => this.applyAction(roomId, playerId, action));
  }

  private async applyAction(
    roomId: string,
    playerId: string,
    action: GameAction,
  ): Promise<ActionOutcome> {
    const state = await this.getCurrentState(roomId);
    if (!state || state.status !== 'active') {
      return this.idle(state);
    }

    const engine = await this.engineForRoom(roomId);
    const next = engine.handleAction(state, playerId, action);
    if (next === state) return this.idle(state);

    return this.transit(roomId, engine, next);
  }

  async handleTimeout(roomId: string): Promise<ActionOutcome> {
    return this.withRoomLock(roomId, () => this.applyTimeout(roomId));
  }

  private async applyTimeout(roomId: string): Promise<ActionOutcome> {
    const state = await this.getCurrentState(roomId);
    if (!state || state.status !== 'active') {
      return this.idle(state);
    }

    const engine = await this.engineForRoom(roomId);
    if (typeof engine.tickExpired !== 'function') return this.idle(state);

    const next = engine.tickExpired(state);
    if (next === state) return this.idle(state);

    return this.transit(roomId, engine, next);
  }

  private async transit(
    roomId: string,
    engine: MultiplayerGame<GameStateBase, GameAction>,
    next: GameStateBase,
  ): Promise<ActionOutcome> {
    const roundEnded = engine.isRoundOver(next);
    const endedRoundNumber = next.roundNumber;
    const finished = roundEnded && engine.isFinished(next);

    if (finished) {
      next.status = 'finished';
      next.winnerId = next.roundWinnerId ?? this.winnerFromScores(next);
    }

    const results = finished ? engine.getResults(next) : null;

    if (roundEnded) {
      await this.persistRoundEnd(roomId, next, next.roundNumber, finished);
    } else {
      await this.persistRound(roomId, next);
    }

    let broadcastState = next;

    if (finished) {
      await this.prisma.gameRoom.update({
        where: { id: roomId },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      await this.persistScores(roomId, next);
      this.live.delete(roomId);
    } else if (roundEnded) {
      broadcastState = await this.startNextRound(roomId, next);
    } else {
      this.live.set(roomId, next);
    }

    const endedState = roundEnded ? next : null;

    return {
      state: broadcastState,
      endedState,
      changed: true,
      roundEnded,
      roundWinnerId: next.roundWinnerId,
      endedRoundNumber,
      finished,
      results,
    };
  }

  /**
   * The viewer-facing projection of the authoritative state:
   * unanswered question keys and unplayed hunt targets are removed.
   */
  sanitizeForViewer(userId: string, state: GameStateBase): GameStateBase {
    const view: GameStateBase = JSON.parse(JSON.stringify(state));

    if (view.gameType === 'SPEED_BATTLE') {
      return this.sanitizeSpeedBattle(userId, view as SpeedBattleState);
    }
    if (view.gameType === 'NUMBER_HUNT') {
      return this.sanitizeNumberHunt(userId, view as NumberHuntState);
    }
    if (view.gameType === 'MEMORY_MATCH') {
      return this.sanitizeMemoryMatch(view as MemoryMatchState);
    }
    return view;
  }

  private sanitizeSpeedBattle(
    userId: string,
    state: SpeedBattleState,
  ): SpeedBattleState {
    const roundOver = state.questionDeadline === null;
    const revealedUpTo = roundOver
      ? state.currentQuestionIndex
      : state.currentQuestionIndex - 1;

    state.questions = state.questions.map((question, index) => {
      if (index <= revealedUpTo) return question;
      const { correctIndex, ...public_fields } = question;
      return public_fields as typeof question;
    });

    if (!roundOver) {
      state.answers = this.stripOtherAnswers(userId, state.answers);
    }
    return state;
  }

  private stripOtherAnswers(
    userId: string,
    answers: Record<string, { optionIndex: number; correct: boolean; answeredAt: number } | null>,
  ): Record<string, { optionIndex: number; correct: boolean; answeredAt: number } | null> {
    return Object.fromEntries(
      Object.entries(answers).map(([playerId, answer]) => [
        playerId,
        playerId === userId || answer === null
          ? answer
          : { answeredAt: answer.answeredAt, optionIndex: -1, correct: false },
      ]),
    );
  }

  /**
   * While a race call is open, the partner's tap (and whether it was
   * correct) stays hidden until the round ends.
   */
  private sanitizeNumberHunt(
    userId: string,
    state: NumberHuntState,
  ): NumberHuntState {
    if (state.callDeadline !== null) {
      state.firstTapped = this.stripOtherTaps(userId, state.firstTapped);
    }
    return state;
  }

  /** Hidden cards carry symbol -1 so viewers can't read the socket payload. */
  private sanitizeMemoryMatch(state: MemoryMatchState): MemoryMatchState {
    const revealing = state.memorizeDeadline !== null;
    state.cards = state.cards.map((card) =>
      revealing || card.matchedBy !== null || card.flippedBy !== null
        ? card
        : { ...card, symbol: -1 },
    );
    return state;
  }

  private stripOtherTaps(
    userId: string,
    firstTapped: Record<string, { number: number; tappedAt: number } | null>,
  ): Record<string, { number: number; tappedAt: number } | null> {
    return Object.fromEntries(
      Object.entries(firstTapped).map(([playerId, tap]) => [
        playerId,
        playerId === userId || tap === null
          ? tap
          : { number: -1, tappedAt: tap.tappedAt },
      ]),
    );
  }

  dropLive(roomId: string): void {
    this.live.delete(roomId);
    this.locks.delete(roomId);
  }

  private idle(state: GameStateBase | null): ActionOutcome {
    return {
      state: state as GameStateBase,
      endedState: null,
      changed: false,
      roundEnded: false,
      roundWinnerId: null,
      endedRoundNumber: null,
      finished: false,
      results: null,
    };
  }

  private winnerFromScores(state: GameStateBase): string | null {
    const entries = Object.entries(state.roundsWon);
    if (entries.length < 2) return null;
    const [aId, aWins] = entries[0];
    const [bId, bWins] = entries[1];
    if (aWins === bWins) return null;
    return aWins > bWins ? aId : bId;
  }

  private async persistRound(roomId: string, state: GameStateBase) {
    try {
      await this.prisma.gameRound.update({
        where: { roomId_roundNumber: { roomId, roundNumber: state.roundNumber } },
        data: { data: JSON.stringify(state) },
      });
    } catch (err) {
      this.logger.error(`Failed to persist round for room ${roomId}: ${err}`);
    }
  }

  private async persistRoundEnd(
    roomId: string,
    state: GameStateBase,
    roundNumber: number,
    finished: boolean,
  ) {
    try {
      await this.prisma.gameRound.update({
        where: { roomId_roundNumber: { roomId, roundNumber } },
        data: {
          state: 'finished',
          endedAt: new Date(),
          data: JSON.stringify(state),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to persist round end for room ${roomId}: ${err}`);
    }
  }

  private async persistScores(roomId: string, state: GameStateBase) {
    try {
      const scoreEntries = Object.entries(state.scores);
      if (scoreEntries.length === 0) return;
      await Promise.all(
        scoreEntries.map(([userId, score]) =>
          this.prisma.gamePlayer.update({
            where: { roomId_userId: { roomId, userId } },
            data: { score },
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`Failed to persist scores for room ${roomId}: ${err}`);
    }
  }

  private async startNextRound(
    roomId: string,
    prev: GameStateBase,
  ): Promise<GameStateBase> {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
    if (!room) return prev;

    const engine = this.engineFor(room.gameType);
    const next = engine.startNextRound(prev, roomId, room.players as any);

    await this.prisma.$transaction([
      this.prisma.gameRound.create({
        data: {
          roomId,
          roundNumber: next.roundNumber,
          state: 'active',
          data: JSON.stringify(next),
          startedAt: new Date(),
        },
      }),
      this.prisma.gameRoom.update({
        where: { id: roomId },
        data: { currentRound: next.roundNumber },
      }),
    ]);
    this.live.set(roomId, next);
    return next;
  }
}
