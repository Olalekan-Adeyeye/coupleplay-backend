// Common game engine types — server is authoritative for all game state.

export interface GameAction {
  action: string;
  payload?: any;
}

export interface PlayerScore {
  userId: string;
  score: number;
}

export interface GameStateBase {
  roomId: string;
  gameType: string;
  status: 'active' | 'finished';
  roundNumber: number;
  totalRounds: number;
  scores: Record<string, number>;
  roundsWon: Record<string, number>;
  turnUserId: string | null;
  roundWinnerId: string | null;
  winnerId: string | null;
}

export interface GameResult {
  gameType: string;
  winnerId: string | null;
  scores: Record<string, number>;
  totalRounds: number;
}

export interface RoomPlayer {
  id: string;
  userId: string;
  roomId: string;
  score: number;
  ready: boolean;
  connected: boolean;
}

/**
 * A server-authoritative multiplayer game. Engines are pure —
 * no NestJS dependencies — so they can be unit tested in isolation.
 *
 * `handleAction` must be idempotent-safe: it either validates and
 * applies the action, or returns the state unchanged.
 */
export interface MultiplayerGame<S extends GameStateBase, A extends GameAction> {
  gameType: string;

  createGame(roomId: string, players: RoomPlayer[], totalRounds: number): S;

  /** Fresh state for the round after `prevState`'s round. May swap marks/turn order. */
  startNextRound(prevState: S, roomId: string, players: RoomPlayer[]): S;

  handleAction(state: S, playerId: string, action: A): S;

  isFinished(state: S): boolean;

  getResults(state: S): GameResult;
}
