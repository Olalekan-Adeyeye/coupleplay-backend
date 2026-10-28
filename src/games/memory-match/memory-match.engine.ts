import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
  RoomPlayer,
} from '../game.types';

export interface MemoryMatchCard {
  symbol: number;
  flippedBy: string | null;
  matchedBy: string | null;
}

export interface MemoryMatchState extends GameStateBase {
  cards: MemoryMatchCard[];
  flippedThisTurn: number[];
  memorizeDeadline: number | null;
  revealDeadline: number | null;
  turnDeadline: number | null;
  firstTurnUserId: string;
  roundPairs: Record<string, number>;
  lastMove: { indexes: [number, number]; matched: boolean; playerId: string } | null;
}

export interface MemoryMatchFlipAction extends GameAction {
  action: 'flip';
  payload: { cardIndex: number };
}

export type MemoryMatchAction = MemoryMatchFlipAction;

const PAIRS = 12;
const MEMORIZE_MS = 5_000;
const TURN_MS = 20_000;
const REVEAL_MS = 1_000;

function shuffledDeck(): MemoryMatchCard[] {
  const symbols: number[] = [];
  for (let symbol = 0; symbol < PAIRS; symbol++) symbols.push(symbol, symbol);
  for (let i = symbols.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
  }
  return symbols.map((symbol) => ({ symbol, flippedBy: null, matchedBy: null }));
}

export class MemoryMatchEngine
  implements MultiplayerGame<MemoryMatchState, MemoryMatchAction>
{
  readonly gameType = 'MEMORY_MATCH';

  createGame(
    roomId: string,
    players: RoomPlayer[],
    totalRounds: number,
  ): MemoryMatchState {
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
      cards: shuffledDeck(),
      flippedThisTurn: [],
      memorizeDeadline: Date.now() + MEMORIZE_MS,
      revealDeadline: null,
      turnDeadline: null,
      firstTurnUserId: players[0]?.userId ?? '',
      roundPairs: Object.fromEntries(players.map((p) => [p.userId, 0])),
      lastMove: null,
    };
  }

  startNextRound(
    prevState: MemoryMatchState,
    roomId: string,
    players: RoomPlayer[],
  ): MemoryMatchState {
    const firstTurnUserId =
      players.find((p) => p.userId !== prevState.firstTurnUserId)?.userId ??
      prevState.firstTurnUserId;

    return {
      ...prevState,
      roomId,
      roundNumber: prevState.roundNumber + 1,
      status: 'active',
      cards: shuffledDeck(),
      flippedThisTurn: [],
      memorizeDeadline: Date.now() + MEMORIZE_MS,
      revealDeadline: null,
      turnDeadline: null,
      turnUserId: null,
      roundWinnerId: null,
      firstTurnUserId,
      roundPairs: Object.fromEntries(players.map((p) => [p.userId, 0])),
      lastMove: null,
    };
  }

  handleAction(
    state: MemoryMatchState,
    playerId: string,
    action: MemoryMatchAction,
  ): MemoryMatchState {
    if (state.status !== 'active') return state;
    if (action.action !== 'flip') return state;
    if (state.memorizeDeadline || state.revealDeadline) return state;
    if (playerId !== state.turnUserId) return state;

    const { cardIndex } = action.payload ?? {};
    if (!Number.isInteger(cardIndex)) return state;
    if (cardIndex < 0 || cardIndex >= state.cards.length) return state;
    if (state.flippedThisTurn.includes(cardIndex)) return state;
    if (state.flippedThisTurn.length >= 2) return state;

    const card = state.cards[cardIndex];
    if (card.flippedBy || card.matchedBy) return state;

    const cards = state.cards.map((c, i) =>
      i === cardIndex ? { ...c, flippedBy: playerId } : c,
    );
    const flippedThisTurn = [...state.flippedThisTurn, cardIndex];

    if (flippedThisTurn.length === 1) {
      return { ...state, cards, flippedThisTurn };
    }

    const [first, second] = flippedThisTurn;
    const matched = cards[first].symbol === cards[second].symbol;

    if (!matched) {
      return {
        ...state,
        cards,
        flippedThisTurn,
        turnDeadline: null,
        revealDeadline: Date.now() + REVEAL_MS,
        lastMove: { indexes: [first, second], matched: false, playerId },
      };
    }

    const next: MemoryMatchState = {
      ...state,
      cards: cards.map((c, i) =>
        i === first || i === second ? { ...c, matchedBy: playerId } : c,
      ),
      flippedThisTurn: [],
      scores: { ...state.scores, [playerId]: (state.scores[playerId] ?? 0) + 1 },
      roundPairs: {
        ...state.roundPairs,
        [playerId]: (state.roundPairs[playerId] ?? 0) + 1,
      },
      lastMove: { indexes: [first, second], matched: true, playerId },
    };

    if (next.cards.every((c) => c.matchedBy)) {
      return this.endRound(next);
    }

    return { ...next, turnDeadline: Date.now() + TURN_MS };
  }

  tickExpired(state: MemoryMatchState): MemoryMatchState {
    if (state.status !== 'active') return state;

    const now = Date.now();
    if (state.memorizeDeadline && now >= state.memorizeDeadline) {
      return {
        ...state,
        memorizeDeadline: null,
        turnUserId: state.firstTurnUserId,
        turnDeadline: now + TURN_MS,
      };
    }
    if (state.revealDeadline && now >= state.revealDeadline) {
      return this.passTurn(state);
    }
    if (state.turnDeadline && now >= state.turnDeadline) {
      return this.passTurn(state);
    }
    return state;
  }

  private passTurn(state: MemoryMatchState): MemoryMatchState {
    const other =
      Object.keys(state.scores).find((id) => id !== state.turnUserId) ?? null;
    const flipped = new Set(state.flippedThisTurn);
    const cards = state.cards.map((c, i) =>
      flipped.has(i) ? { ...c, flippedBy: null } : c,
    );

    return {
      ...state,
      cards,
      flippedThisTurn: [],
      revealDeadline: null,
      turnUserId: other,
      turnDeadline: other ? Date.now() + TURN_MS : null,
    };
  }

  private endRound(state: MemoryMatchState): MemoryMatchState {
    const entries = Object.entries(state.roundPairs);
    const roundsWon = { ...state.roundsWon };
    let roundWinnerId: string | null = null;

    if (entries.length >= 2) {
      const [aId, aPairs] = entries[0];
      const [bId, bPairs] = entries[1];
      if (aPairs > bPairs) {
        roundsWon[aId] = (roundsWon[aId] ?? 0) + 1;
        roundWinnerId = aId;
      } else if (bPairs > aPairs) {
        roundsWon[bId] = (roundsWon[bId] ?? 0) + 1;
        roundWinnerId = bId;
      }
    }

    return {
      ...state,
      roundsWon,
      roundWinnerId,
      turnUserId: null,
      turnDeadline: null,
      flippedThisTurn: [],
    };
  }

  isRoundOver(state: MemoryMatchState): boolean {
    return state.cards.every((c) => c.matchedBy);
  }

  isFinished(state: MemoryMatchState): boolean {
    if (state.status === 'finished') return true;
    if (state.totalRounds > 0 && state.roundNumber >= state.totalRounds) return true;
    const wins = Object.values(state.roundsWon);
    if (wins.length < 2) return false;
    const maxWins = Math.max(...wins);
    return maxWins >= Math.ceil(state.totalRounds / 2);
  }

  getResults(state: MemoryMatchState): GameResult {
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
