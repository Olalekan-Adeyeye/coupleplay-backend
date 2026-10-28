import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private gamesService: GamesService) {}

  @Get()
  listGames() {
    return this.gamesService.listGames();
  }

  @Get(':id')
  getGame(@Param('id') id: string) {
    const game = this.gamesService.getGame(id);
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }
}
