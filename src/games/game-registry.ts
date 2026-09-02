import { GameAction, GameStateBase, MultiplayerGame } from './game.types';
import { TicTacToeEngine } from './tic-tac-toe/tic-tac-toe.engine';
import { SpeedBattleEngine } from './speed-battle/speed-battle.engine';

// Adding a game = adding one entry here. Nothing else changes.
export const GAME_ENGINES: Record<
  string,
  MultiplayerGame<GameStateBase, GameAction>
> = {
  TIC_TAC_TOE: new TicTacToeEngine() as unknown as MultiplayerGame<
    GameStateBase,
    GameAction
  >,
  SPEED_BATTLE: new SpeedBattleEngine() as unknown as MultiplayerGame<
    GameStateBase,
    GameAction
  >,
};
