import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
  RoomPlayer,
} from '../game.types';

export type Mark = 'X' | 'O';

export interface TicTacToeState extends GameStateBase {
  board: (Mark | null)[][];
  marks: Record<string, Mark>;
  lastMove: { row: number; col: number } | null;
}

export interface TicTacToeAction extends GameAction {
  action: 'place';
  payload: { row: number; col: number };
}

const LINES: [number, number][][] = [
  // rows
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  // columns
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  // diagonals
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
];

function emptyBoard(): (Mark | null)[][] {
  return [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
}

function winningLine(board: (Mark | null)[][]): [number, number][] | null {
  for (const line of LINES) {
    const [a, b, c] = line.map(([r, col]) => board[r][col]);
    if (a && a === b && b === c) return line;
  }
  return null;
}

function isBoardFull(board: (Mark | null)[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

export class TicTacToeEngine
  implements MultiplayerGame<TicTacToeState, TicTacToeAction>
{
  readonly gameType = 'TIC_TAC_TOE';

  createGame(
    roomId: string,
    players: RoomPlayer[],
    totalRounds: number,
  ): TicTacToeState {
    return this.newRoundState(roomId, players, totalRounds, 1, {}, {}, false);
  }

  startNextRound(
    prevState: TicTacToeState,
    roomId: string,
    players: RoomPlayer[],
  ): TicTacToeState {
    // Alternate marks & first move each round: rotate player order.
    const rotated = [...players.slice(1), ...players.slice(0, 1)];
    return this.newRoundState(
      roomId,
      rotated,
      prevState.totalRounds,
      prevState.roundNumber + 1,
      prevState.scores,
      prevState.roundsWon,
      false,
    );
  }

  private newRoundState(
    roomId: string,
    players: RoomPlayer[],
    totalRounds: number,
    roundNumber: number,
    scores: Record<string, number>,
    roundsWon: Record<string, number>,
    _swapMarks: boolean,
  ): TicTacToeState {
    const marks: Record<string, Mark> = {};
    players.forEach((p, i) => {
      marks[p.userId] = i === 0 ? 'X' : 'O';
      if (!(p.userId in scores)) scores[p.userId] = 0;
      if (!(p.userId in roundsWon)) roundsWon[p.userId] = 0;
    });

    return {
      roomId,
      gameType: this.gameType,
      status: 'active',
      roundNumber,
      totalRounds,
      scores: { ...scores },
      roundsWon: { ...roundsWon },
      turnUserId: players[0]?.userId ?? null,
      roundWinnerId: null,
      winnerId: null,
      board: emptyBoard(),
      marks,
      lastMove: null,
    };
  }

  handleAction(
    state: TicTacToeState,
    playerId: string,
    action: TicTacToeAction,
  ): TicTacToeState {
    if (state.status !== 'active') return state;
    if (action.action !== 'place') return state;

    const { row, col } = action.payload ?? {};
    if (row == null || col == null) return state;
    if (row < 0 || row > 2 || col < 0 || col > 2) return state;

    // Not your turn, or cell already taken → reject (no state change).
    if (playerId !== state.turnUserId) return state;
    if (state.board[row][col] !== null) return state;

    const mark = state.marks[playerId];
    const board = state.board.map((r) => [...r]);
    board[row][col] = mark;

    const next: TicTacToeState = {
      ...state,
      board,
      lastMove: { row, col },
    };

    const line = winningLine(board);
    if (line) {
      next.roundWinnerId = playerId;
      next.roundsWon = { ...state.roundsWon, [playerId]: (state.roundsWon[playerId] ?? 0) + 1 };
      next.scores = { ...state.scores, [playerId]: (state.scores[playerId] ?? 0) + 1 };
      next.turnUserId = null;
      if (this.isFinished(next)) {
        next.status = 'finished';
        next.winnerId = playerId;
      }
      return next;
    }

    if (isBoardFull(board)) {
      next.roundWinnerId = null;
      next.turnUserId = null;
      if (next.roundNumber >= next.totalRounds) {
        next.status = 'finished';
        next.winnerId = this.computeWinnerId(next);
      }
      return next;
    }

    // Pass the turn to the other player.
    const other = Object.keys(state.scores).find((id) => id !== playerId);
    next.turnUserId = other ?? null;
    return next;
  }

  isFinished(state: TicTacToeState): boolean {
    if (state.status === 'finished') return true;
    // Best-of-N: enough wins that the trailing player can't catch up.
    const wins = Object.values(state.roundsWon);
    if (wins.length < 2) return false;
    const maxWins = Math.max(...wins);
    return maxWins >= Math.ceil(state.totalRounds / 2);
  }

  getResults(state: TicTacToeState): GameResult {
    return {
      gameType: this.gameType,
      winnerId: state.winnerId ?? this.computeWinnerId(state),
      scores: { ...state.scores },
      totalRounds: state.totalRounds,
    };
  }

  private computeWinnerId(state: TicTacToeState): string | null {
    const entries = Object.entries(state.roundsWon);
    if (entries.length < 2) return null;
    const [aId, aWins] = entries[0];
    const [bId, bWins] = entries[1];
    if (aWins === bWins) return null;
    return aWins > bWins ? aId : bId;
  }
}
