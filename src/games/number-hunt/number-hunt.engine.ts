import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
  RoomPlayer,
} from '../game.types';
import { generateGrid, pickTargets } from './number-hunt-grid';

/* ── State ──────────────────────────────────────────────────────── */

export interface NumberHuntState extends GameStateBase {
  mode: 'hunt' | 'race' | null;
  grid: number[];

  // Hunt mode
  targetNumbers: number[];
  finderId: string | null;
  pickerId: string | null;
  foundByPlayer: Record<string, number[]>;
  currentTargetIndex: number;
  totalTargets: number;
  roundDeadline: number | null;

  // Race mode
  currentCall: number | null;
  callIndex: number;
  totalCalls: number;
  callDeadline: number | null;
  firstTapped: Record<string, { number: number; tappedAt: number } | null>;
}

/* ── Actions ─────────────────────────────────────────────────────── */

export interface SelectTargetsAction extends GameAction {
  action: 'select_targets';
  payload: { numbers: number[] };
}

export interface SelectModeAction extends GameAction {
  action: 'select_mode';
  payload: { mode: 'hunt' | 'race' };
}

export interface FoundAction extends GameAction {
  action: 'found';
  payload: { number: number };
}

export interface TapAction extends GameAction {
  action: 'tap';
  payload: { number: number };
}

export type NumberHuntAction = SelectModeAction | SelectTargetsAction | FoundAction | TapAction;

/* ── Constants ───────────────────────────────────────────────────── */

const HUNT_TARGETS = 5;
const HUNT_TIME_MS = 30_000;
const RACE_TOTAL_CALLS = 10;
const RACE_CALL_INTERVAL_MS = 3_000;

/* ── Helpers ─────────────────────────────────────────────────────── */

function pickCallNumber(grid: number[]): number {
  return grid[Math.floor(Math.random() * grid.length)];
}

/* ── Engine ──────────────────────────────────────────────────────── */

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

    // Round 1: first player is picker, second is finder
    const pickerId = players[0]?.userId ?? '';
    const finderId = players[1]?.userId ?? '';

    return {
      roomId,
      gameType: this.gameType,
      status: 'active',
      roundNumber: 1,
      totalRounds,
      scores,
      roundsWon,
      turnUserId: pickerId,
      roundWinnerId: null,
      winnerId: null,

      mode: null,
      grid,
      targetNumbers: [],
      finderId,
      pickerId,
      foundByPlayer: Object.fromEntries(players.map((p) => [p.userId, []])),
      currentTargetIndex: 0,
      totalTargets: HUNT_TARGETS,
      roundDeadline: null,

      currentCall: null,
      callIndex: 0,
      totalCalls: RACE_TOTAL_CALLS,
      callDeadline: null,
      firstTapped: Object.fromEntries(players.map((p) => [p.userId, null])),
    };
  }

  startNextRound(
    prev: NumberHuntState,
    roomId: string,
    players: RoomPlayer[],
  ): NumberHuntState {
    const grid = generateGrid();
    const scores = { ...prev.scores };
    const roundsWon = { ...prev.roundsWon };

    // Alternate picker/finder each round
    const prevPicker = prev.pickerId;
    const pickerId =
      players.find((p) => p.userId !== prevPicker)?.userId ?? prevPicker;
    const finderId =
      players.find((p) => p.userId !== pickerId)?.userId ?? '';

    // Keep the same mode for all rounds
    const currentMode = prev.mode ?? 'hunt';

    // For race mode, start the first call immediately
    const firstCall = currentMode === 'race' ? pickCallNumber(grid) : null;
    const firstDeadline = currentMode === 'race' ? Date.now() + RACE_CALL_INTERVAL_MS : null;

    return {
      ...prev,
      roomId,
      roundNumber: prev.roundNumber + 1,
      mode: currentMode,
      grid,
      targetNumbers: [],
      finderId,
      pickerId,
      foundByPlayer: Object.fromEntries(players.map((p) => [p.userId, []])),
      currentTargetIndex: 0,
      totalTargets: HUNT_TARGETS,
      roundDeadline: null,
      currentCall: firstCall,
      callIndex: 0,
      totalCalls: RACE_TOTAL_CALLS,
      callDeadline: firstDeadline,
      firstTapped: Object.fromEntries(players.map((p) => [p.userId, null])),
      roundWinnerId: null,
      turnUserId: currentMode === 'hunt' ? pickerId : null,
      scores,
      roundsWon,
    };
  }

  handleAction(
    state: NumberHuntState,
    playerId: string,
    action: NumberHuntAction,
  ): NumberHuntState {
    if (state.status !== 'active') return state;

    if (action.action === 'select_mode') {
      if (state.mode != null) return state; // already selected
      const { mode } = (action as SelectModeAction).payload ?? {};
      if (mode !== 'hunt' && mode !== 'race') return state;

      const next: NumberHuntState = { ...state, mode };
      if (mode === 'race') {
        // Start the first race call immediately
        return {
          ...next,
          currentCall: pickCallNumber(next.grid),
          callDeadline: Date.now() + RACE_CALL_INTERVAL_MS,
        };
      }
      // Hunt mode: wait for picker to select targets
      return { ...next, turnUserId: next.pickerId };
    }

    if (state.mode === null) return state; // mode not selected yet

    if (state.mode === 'hunt') {
      return this.handleHuntAction(state, playerId, action);
    }
    return this.handleRaceAction(state, playerId, action);
  }

  /* ── Hunt mode actions ─────────────────────────────────────── */

  private handleHuntAction(
    state: NumberHuntState,
    playerId: string,
    action: NumberHuntAction,
  ): NumberHuntState {
    if (action.action === 'select_targets') {
      // Only the picker can select targets
      if (playerId !== state.pickerId) return state;
      if (state.targetNumbers.length > 0) return state;

      const { numbers } = (action as SelectTargetsAction).payload ?? {};
      if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > 5) {
        return state;
      }

      // Validate all numbers are on the grid
      if (!numbers.every((n) => state.grid.includes(n))) return state;

      return {
        ...state,
        targetNumbers: numbers,
        totalTargets: numbers.length,
        turnUserId: state.finderId,
        roundDeadline: Date.now() + HUNT_TIME_MS,
      };
    }

    if (action.action === 'found') {
      // Only the finder can find, and only after targets are selected
      if (playerId !== state.finderId) return state;
      if (state.targetNumbers.length === 0) return state;
      if (!state.roundDeadline || Date.now() > state.roundDeadline) return state;

      const { number } = (action as FoundAction).payload ?? {};
      if (number == null || !state.grid.includes(number)) return state;

      const alreadyFound = state.foundByPlayer[playerId] ?? [];
      if (alreadyFound.includes(number)) return state;

      const newFound = [...alreadyFound, number];
      const newFoundByPlayer = {
        ...state.foundByPlayer,
        [playerId]: newFound,
      };

      const next: NumberHuntState = {
        ...state,
        foundByPlayer: newFoundByPlayer,
      };

      // Check if all targets found
      const allFound = next.targetNumbers.every((t) => newFound.includes(t));
      if (allFound) {
        return this.endHuntRound(next);
      }

      return next;
    }

    return state;
  }

  private endHuntRound(state: NumberHuntState): NumberHuntState {
    const finder = state.finderId ?? '';
    const picker = state.pickerId ?? '';
    const found = state.foundByPlayer[finder] ?? [];
    const targetsFound = state.targetNumbers.filter((t) => found.includes(t)).length;
    const missed = state.targetNumbers.length - targetsFound;

    const scores = { ...state.scores };
    // Finder gets 1 point per target found
    scores[finder] = (scores[finder] ?? 0) + targetsFound;
    // Picker gets 1 point per unfound target
    scores[picker] = (scores[picker] ?? 0) + missed;

    // Bonus for finding all: +2 if more than 10s remaining
    if (targetsFound === state.targetNumbers.length && state.roundDeadline) {
      const timeRemaining = state.roundDeadline - Date.now();
      if (timeRemaining > 10_000) {
        scores[finder] = (scores[finder] ?? 0) + 2;
      }
    }

    const roundsWon = { ...state.roundsWon };
    if (targetsFound > missed) {
      roundsWon[finder] = (roundsWon[finder] ?? 0) + 1;
    } else if (missed > targetsFound) {
      roundsWon[picker] = (roundsWon[picker] ?? 0) + 1;
    }
    // Equal = draw, no one gets a round win

    return {
      ...state,
      scores,
      roundsWon,
      roundWinnerId:
        targetsFound > missed
          ? finder
          : missed > targetsFound
            ? picker
            : null,
      turnUserId: null,
      roundDeadline: null,
    };
  }

  /* ── Race mode actions ─────────────────────────────────────── */

  private handleRaceAction(
    state: NumberHuntState,
    playerId: string,
    action: NumberHuntAction,
  ): NumberHuntState {
    if (action.action !== 'tap') return state;
    if (state.currentCall == null) return state;
    if (!state.callDeadline || Date.now() > state.callDeadline) return state;

    const { number } = (action as TapAction).payload ?? {};
    if (number == null) return state;

    // Already tapped for this call?
    if (state.firstTapped[playerId] != null) return state;

    const now = Date.now();
    const correct = number === state.currentCall;

    const firstTapped = {
      ...state.firstTapped,
      [playerId]: { number, tappedAt: now },
    };

    const next: NumberHuntState = { ...state, firstTapped };

    if (correct) {
      const scores = { ...next.scores };
      scores[playerId] = (scores[playerId] ?? 0) + 1;
      next.scores = scores;

      // Check if both players have tapped
      const bothTapped = Object.values(firstTapped).every((v) => v != null);
      if (bothTapped) {
        return this.advanceRaceCall(next);
      }
      // First correct tap — wait briefly for partner, then advance
      // The timeout will handle this if partner doesn't tap
      return next;
    }

    // Wrong tap — penalty
    const scores = { ...next.scores };
    scores[playerId] = Math.max(0, (scores[playerId] ?? 0) - 1);
    next.scores = scores;

    // Check if both players have tapped (even wrong ones)
    const bothTapped = Object.values(firstTapped).every((v) => v != null);
    if (bothTapped) {
      return this.advanceRaceCall(next);
    }

    return next;
  }

  advanceRaceCall(state: NumberHuntState): NumberHuntState {
    const nextIndex = state.callIndex + 1;

    if (nextIndex >= state.totalCalls) {
      return this.endRaceRound(state);
    }

    return {
      ...state,
      callIndex: nextIndex,
      currentCall: pickCallNumber(state.grid),
      callDeadline: Date.now() + RACE_CALL_INTERVAL_MS,
      firstTapped: Object.fromEntries(
        Object.keys(state.firstTapped).map((k) => [k, null]),
      ),
    };
  }

  startRaceCall(state: NumberHuntState): NumberHuntState {
    return {
      ...state,
      currentCall: pickCallNumber(state.grid),
      callDeadline: Date.now() + RACE_CALL_INTERVAL_MS,
    };
  }

  private endRaceRound(state: NumberHuntState): NumberHuntState {
    const entries = Object.entries(state.scores);
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

  /* ── Timeout handler ───────────────────────────────────────── */

  tickExpired(state: NumberHuntState): NumberHuntState {
    if (state.status !== 'active') return state;

    if (state.mode === 'hunt') {
      return this.endHuntRound(state);
    }

    // Race mode: advance to next call or end round
    return this.advanceRaceCall(state);
  }

  /* ── Lifecycle ─────────────────────────────────────────────── */

  isFinished(state: NumberHuntState): boolean {
    if (state.status === 'finished') return true;
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
      totalRounds: state.totalRounds,
    };
  }
}
