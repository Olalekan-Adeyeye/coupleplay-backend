import {
  GameAction,
  GameResult,
  GameStateBase,
  MultiplayerGame,
  RoomPlayer,
} from '../game.types';
import {
  SpeedBattleQuestion,
  SPEED_BATTLE_QUESTIONS,
} from './speed-battle-questions';

export interface SpeedBattleState extends GameStateBase {
  currentQuestionIndex: number;
  questions: { id: string; question: string; options: { text: string; emoji: string }[]; correctIndex: number }[];
  answers: Record<string, { optionIndex: number; correct: boolean; answeredAt: number } | null>;
  questionDeadline: number | null;
  firstCorrectId: string | null;
  secondCorrectId: string | null;
}

export interface SpeedBattleAnswerAction extends GameAction {
  action: 'answer';
  payload: { optionIndex: number };
}

const ANSWER_TIME_MS = 15_000;

function pickQuestions(count: number): SpeedBattleQuestion[] {
  const shuffled = [...SPEED_BATTLE_QUESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export class SpeedBattleEngine
  implements MultiplayerGame<SpeedBattleState, SpeedBattleAnswerAction>
{
  readonly gameType = 'SPEED_BATTLE';

  createGame(
    roomId: string,
    players: RoomPlayer[],
    totalRounds: number,
  ): SpeedBattleState {
    const questions = pickQuestions(totalRounds);
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
      currentQuestionIndex: 0,
      questions,
      answers: Object.fromEntries(players.map((p) => [p.userId, null])),
      questionDeadline: Date.now() + ANSWER_TIME_MS,
      firstCorrectId: null,
      secondCorrectId: null,
    };
  }

  startNextRound(
    prev: SpeedBattleState,
    roomId: string,
    players: RoomPlayer[],
  ): SpeedBattleState {
    const nextIndex = prev.currentQuestionIndex + 1;
    const scores = { ...prev.scores };
    const roundsWon = { ...prev.roundsWon };

    return {
      ...prev,
      roomId,
      roundNumber: prev.roundNumber + 1,
      currentQuestionIndex: nextIndex,
      answers: Object.fromEntries(players.map((p) => [p.userId, null])),
      questionDeadline: Date.now() + ANSWER_TIME_MS,
      roundWinnerId: null,
      firstCorrectId: null,
      secondCorrectId: null,
      turnUserId: null,
      scores,
      roundsWon,
    };
  }

  handleAction(
    state: SpeedBattleState,
    playerId: string,
    action: SpeedBattleAnswerAction,
  ): SpeedBattleState {
    if (state.status !== 'active') return state;
    if (action.action !== 'answer') return state;
    if (state.questionDeadline && Date.now() > state.questionDeadline) return state;

    const { optionIndex } = action.payload ?? {};
    if (optionIndex == null) return state;

    // Already answered this question
    if (state.answers[playerId] != null) return state;

    const question = state.questions[state.currentQuestionIndex];
    if (!question) return state;

    const correct = optionIndex === question.correctIndex;
    const now = Date.now();

    const answers = { ...state.answers, [playerId]: { optionIndex, correct, answeredAt: now } };
    const next: SpeedBattleState = { ...state, answers };

    if (correct) {
      if (next.firstCorrectId == null) {
        next.firstCorrectId = playerId;
        next.scores = { ...next.scores, [playerId]: (next.scores[playerId] ?? 0) + 3 };
      } else if (next.secondCorrectId == null && next.firstCorrectId !== playerId) {
        next.secondCorrectId = playerId;
        next.scores = { ...next.scores, [playerId]: (next.scores[playerId] ?? 0) + 1 };
      }
    }

    // Check if both players have answered
    const allAnswered = Object.values(answers).every((a) => a != null);
    if (allAnswered) {
      return this.endRound(next);
    }

    return next;
  }

  /** Called by the engine service when the timer expires. */
  tickExpired(state: SpeedBattleState): SpeedBattleState {
    if (state.status !== 'active') return state;
    return this.endRound(state);
  }

  private endRound(state: SpeedBattleState): SpeedBattleState {
    const next = { ...state, questionDeadline: null, turnUserId: null };

    // Determine round winner by who answered correctly first
    if (next.firstCorrectId) {
      next.roundWinnerId = next.firstCorrectId;
      next.roundsWon = {
        ...next.roundsWon,
        [next.firstCorrectId]: (next.roundsWon[next.firstCorrectId] ?? 0) + 1,
      };
    } else {
      next.roundWinnerId = null;
    }

    return next;
  }

  isFinished(state: SpeedBattleState): boolean {
    if (state.status === 'finished') return true;
    const wins = Object.values(state.roundsWon);
    if (wins.length < 2) return false;
    const maxWins = Math.max(...wins);
    return maxWins >= Math.ceil(state.totalRounds / 2);
  }

  getResults(state: SpeedBattleState): GameResult {
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
