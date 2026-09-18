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
      id: 'speed-battle',
      name: 'Speed Battle',
      description: 'Race to answer first!',
      category: 'Competitive',
      minPlayers: 2,
      maxPlayers: 2,
    },
    {
      id: 'number-hunt',
      name: 'Number Hunt',
      description: 'Find the numbers in the honeycomb!',
      category: 'Competitive',
      minPlayers: 2,
      maxPlayers: 2,
    },
    {
      id: 'draw-guess',
      name: 'Draw & Guess',
      description: 'Draw a word and let your partner guess!',
      category: 'Creative',
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
