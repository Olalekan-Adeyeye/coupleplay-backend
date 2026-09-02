import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GAME_ENGINES } from './game-registry';
import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
} from './game.types';

export interface ActionOutcome {
  state: GameStateBase;
  changed: boolean;
  roundEnded: boolean;
  roundWinnerId: string | null;
  finished: boolean;
  results: GameResult | null;
}

@Injectable()
export class GameEngineService {
  private readonly logger = new Logger(GameEngineService.name);

  // Hot in-memory mirror of authoritative state, lazily hydrated from
  // GameRound.data so reconnections and restarts resync cleanly.
  private live = new Map<string, GameStateBase>();

  constructor(private prisma: PrismaService) {}

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
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
    if (!room) throw new Error('Room not found');
    if (room.players.length < 2) throw new Error('Need both players');

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
    const state = await this.getCurrentState(roomId);
    if (!state || state.status !== 'active') {
      return this.idle(state);
    }

    const engine = await this.engineForRoom(roomId);
    const next = engine.handleAction(state, playerId, action);

    // Rejected (not your turn / illegal move) → echo current state only.
    if (next === state) {
      return this.idle(state);
    }

    const roundEnded = next.roundWinnerId !== null || this.isRoundOver(next);
    const finished = roundEnded && engine.isFinished(next);

    if (finished) {
      next.status = 'finished';
      next.winnerId =
        next.roundWinnerId ?? this.winnerFromScores(next);
    }

    const results = finished ? engine.getResults(next) : null;

    if (roundEnded) {
      await this.persistRoundEnd(roomId, next, next.roundNumber, finished);
    } else {
      await this.persistRound(roomId, next);
    }

    // The state to broadcast: the fresh next-round state when the match
    // continues, otherwise the just-played state.
    let broadcastState = next;

    if (finished) {
      await this.prisma.gameRoom.update({
        where: { id: roomId },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      this.live.delete(roomId);
    } else if (roundEnded) {
      broadcastState = await this.startNextRound(roomId, next);
    } else {
      this.live.set(roomId, next);
    }

    return {
      state: broadcastState,
      changed: true,
      roundEnded,
      roundWinnerId: next.roundWinnerId,
      finished,
      results,
    };
  }

  async handleTimeout(roomId: string): Promise<ActionOutcome> {
    const state = await this.getCurrentState(roomId);
    if (!state || state.status !== 'active') {
      return this.idle(state);
    }

    const engine = await this.engineForRoom(roomId);

    // Only speed-battle has tickExpired
    if (typeof (engine as any).tickExpired !== 'function') {
      return this.idle(state);
    }

    const next = (engine as any).tickExpired(state) as GameStateBase;
    if (next === state) return this.idle(state);

    const roundEnded = next.roundWinnerId !== null || this.isRoundOver(next);
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
      this.live.delete(roomId);
    } else if (roundEnded) {
      broadcastState = await this.startNextRound(roomId, next);
    } else {
      this.live.set(roomId, next);
    }

    return {
      state: broadcastState,
      changed: true,
      roundEnded,
      roundWinnerId: next.roundWinnerId,
      finished,
      results,
    };
  }

  /** Drop the in-memory state for a room being destroyed. */
  dropLive(roomId: string): void {
    this.live.delete(roomId);
  }

  private idle(state: GameStateBase | null): ActionOutcome {
    return {
      state: state as GameStateBase,
      changed: false,
      roundEnded: false,
      roundWinnerId: null,
      finished: false,
      results: null,
    };
  }

  private isRoundOver(state: GameStateBase): boolean {
    return state.turnUserId === null;
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
    await this.prisma.gameRound.update({
      where: { roomId_roundNumber: { roomId, roundNumber: state.roundNumber } },
      data: { data: JSON.stringify(state) },
    });
  }

  private async persistRoundEnd(
    roomId: string,
    state: GameStateBase,
    roundNumber: number,
    finished: boolean,
  ) {
    await this.prisma.gameRound.update({
      where: { roomId_roundNumber: { roomId, roundNumber } },
      data: {
        state: finished ? 'finished' : 'finished',
        endedAt: new Date(),
        data: JSON.stringify(state),
      },
    });
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
