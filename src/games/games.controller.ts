import { Controller, Get, Param } from '@nestjs/common';
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
    return this.gamesService.getGame(id);
  }
}
