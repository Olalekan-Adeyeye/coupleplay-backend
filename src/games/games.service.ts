import { Injectable } from '@nestjs/common';

export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  minPlayers: number;
  maxPlayers: number;
}

@Injectable()
export class GamesService {
  private games: GameDefinition[] = [
    {
      id: 'TIC_TAC_TOE',
      name: 'Tic Tac Toe',
      description: 'Three in a row. Loser owes a kiss.',
      category: 'Classic',
      minPlayers: 2,
      maxPlayers: 2,
    },
    {
      id: 'SPEED_BATTLE',
      name: 'Speed Battle',
      description: 'First correct answer takes the point.',
      category: 'Competitive',
      minPlayers: 2,
      maxPlayers: 2,
    },
    {
      id: 'NUMBER_HUNT',
      name: 'Number Hunt',
      description: 'Spot the numbers. Beat the clock. Outsmart your partner.',
      category: 'Competitive',
      minPlayers: 2,
      maxPlayers: 2,
    },
  ];

  listGames(): GameDefinition[] {
    return this.games;
  }

  getGame(id: string): GameDefinition | undefined {
    return this.games.find((g) => g.id === id);
  }
}
