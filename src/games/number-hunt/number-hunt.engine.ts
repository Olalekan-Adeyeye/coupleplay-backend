import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
  RoomPlayer,
} from '../game.types';
import { generateGrid } from './number-hunt-grid';

export interface NumberHuntState extends GameStateBase {
  grid: number[];
  currentCall: number | null;
  callIndex: number;
  totalCalls: number;
  callDeadline: number | null;
  firstTapped: Record<string, { number: number; tappedAt: number } | null>;
  roundRaceScores: Record<string, number>;
}

export interface TapAction extends GameAction {
  action: 'tap';
  payload: { number: number; callIndex: number; roundNumber: number };
}

export type NumberHuntAction = TapAction;

const RACE_TOTAL_CALLS = 10;
const RACE_CALL_INTERVAL_MS = 5_000;

/** Random grid number, never the same as the one just called. */
function pickCallNumber(grid: number[], exclude?: number | null): number {
  const pool = exclude == null ? grid : grid.filter((n) => n !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Race: numbers are called one at a time and both players race to tap it.
 * The first correct tap takes the point and closes the call; a wrong tap
 * costs a point. Scores are net (correct − wrong) at every level.
 */
export class NumberHuntEngine
  implements MultiplayerGame<NumberHuntState, NumberHuntAction>
{
  readonly gameType = 'NUMBER_HUNT';

  createGame(
    roomId: string,
    players: RoomPlayer[],
    totalRounds: number,
  ): NumberHuntState {
    const grid = generateGrid();
    const scores: Record<string, number> = {};
    const roundsWon: Record<string, number> = {};
    for (const p of players) {
      scores[p.userId] = 0;
      roundsWon[p.userId] = 0;
    }

    return {
      roomId,
      gameType: this.gameType,
      status: 'active',
      roundNumber: 1,
      totalRounds,
      scores,
      roundsWon,
      turnUserId: null,
      roundWinnerId: null,
      winnerId: null,
      grid,
      currentCall: pickCallNumber(grid),
      callIndex: 0,
      totalCalls: RACE_TOTAL_CALLS,
      callDeadline: Date.now() + RACE_CALL_INTERVAL_MS,
      firstTapped: Object.fromEntries(players.map((p) => [p.userId, null])),
      roundRaceScores: Object.fromEntries(players.map((p) => [p.userId, 0])),
    };
  }

  startNextRound(
    prev: NumberHuntState,
    roomId: string,
    players: RoomPlayer[],
  ): NumberHuntState {
    const grid = generateGrid();

    return {
      ...prev,
      roomId,
      roundNumber: prev.roundNumber + 1,
      grid,
      currentCall: pickCallNumber(grid),
      callIndex: 0,
      totalCalls: RACE_TOTAL_CALLS,
      callDeadline: Date.now() + RACE_CALL_INTERVAL_MS,
      firstTapped: Object.fromEntries(players.map((p) => [p.userId, null])),
      roundRaceScores: Object.fromEntries(players.map((p) => [p.userId, 0])),
      roundWinnerId: null,
      turnUserId: null,
      scores: { ...prev.scores },
      roundsWon: { ...prev.roundsWon },
    };
  }

  handleAction(
    state: NumberHuntState,
    playerId: string,
    action: NumberHuntAction,
  ): NumberHuntState {
    if (state.status !== 'active') return state;
    if (action.action !== 'tap') return state;
    if (state.currentCall == null) return state;
    if (!state.callDeadline || Date.now() > state.callDeadline) return state;

    const payload = (action as TapAction).payload ?? {};
    const { number } = payload;
    if (!Number.isInteger(number) || !state.grid.includes(number)) return state;

    // Taps must answer the call that is currently open — anything else
    // arrived stale (call already advanced or round already rolled over).
    if (
      payload.callIndex !== state.callIndex ||
      payload.roundNumber !== state.roundNumber
    ) {
      return state;
    }
    if (state.firstTapped[playerId] != null) return state;

    if (number === state.currentCall) {
      const scores = {
        ...state.scores,
        [playerId]: (state.scores[playerId] ?? 0) + 1,
      };
      const roundRaceScores = {
        ...state.roundRaceScores,
        [playerId]: (state.roundRaceScores[playerId] ?? 0) + 1,
      };
      return this.advanceRaceCall({
        ...state,
        scores,
        roundRaceScores,
      });
    }

    const firstTapped = {
      ...state.firstTapped,
      [playerId]: { number, tappedAt: Date.now() },
    };
    const next: NumberHuntState = {
      ...state,
      firstTapped,
      scores: {
        ...state.scores,
        [playerId]: (state.scores[playerId] ?? 0) - 1,
      },
      roundRaceScores: {
        ...state.roundRaceScores,
        [playerId]: (state.roundRaceScores[playerId] ?? 0) - 1,
      },
    };

    if (Object.values(firstTapped).every((v) => v != null)) {
      return this.advanceRaceCall(next);
    }
    return next;
  }

  private advanceRaceCall(state: NumberHuntState): NumberHuntState {
    const nextIndex = state.callIndex + 1;

    if (nextIndex >= state.totalCalls) {
      return this.endRaceRound(state);
    }

    return {
      ...state,
      callIndex: nextIndex,
      currentCall: pickCallNumber(state.grid, state.currentCall),
      callDeadline: Date.now() + RACE_CALL_INTERVAL_MS,
      firstTapped: Object.fromEntries(
        Object.keys(state.firstTapped).map((k) => [k, null]),
      ),
    };
  }

  private endRaceRound(state: NumberHuntState): NumberHuntState {
    const entries = Object.entries(state.roundRaceScores);
    if (entries.length < 2) {
      return {
        ...state,
        roundWinnerId: null,
        turnUserId: null,
        currentCall: null,
        callDeadline: null,
      };
    }

    const [aId, aScore] = entries[0];
    const [bId, bScore] = entries[1];

    const roundsWon = { ...state.roundsWon };
    let roundWinnerId: string | null = null;

    if (aScore > bScore) {
      roundsWon[aId] = (roundsWon[aId] ?? 0) + 1;
      roundWinnerId = aId;
    } else if (bScore > aScore) {
      roundsWon[bId] = (roundsWon[bId] ?? 0) + 1;
      roundWinnerId = bId;
    }

    return {
      ...state,
      roundsWon,
      roundWinnerId,
      turnUserId: null,
      currentCall: null,
      callDeadline: null,
    };
  }

  tickExpired(state: NumberHuntState): NumberHuntState {
    if (state.status !== 'active') return state;
    if (state.callDeadline === null || Date.now() < state.callDeadline) {
      return state;
    }
    return this.advanceRaceCall(state);
  }

  isRoundOver(state: NumberHuntState): boolean {
    return state.currentCall === null && state.callDeadline === null;
  }

  isFinished(state: NumberHuntState): boolean {
    if (state.status === 'finished') return true;
    if (state.totalRounds > 0 && state.roundNumber >= state.totalRounds) return true;
    const wins = Object.values(state.roundsWon);
    if (wins.length < 2) return false;
    const maxWins = Math.max(...wins);
    return maxWins >= Math.ceil(state.totalRounds / 2);
  }

  getResults(state: NumberHuntState): GameResult {
    const entries = Object.entries(state.roundsWon);
    let winnerId: string | null = null;
    if (entries.length >= 2) {
      const [aId, aWins] = entries[0];
      const [bId, bWins] = entries[1];
      if (aWins > bWins) winnerId = aId;
      else if (bWins > aWins) winnerId = bId;
    }

    return {
      gameType: this.gameType,
      winnerId,
      scores: { ...state.scores },
      roundsWon: { ...state.roundsWon },
      totalRounds: state.totalRounds,
    };
  }
}
