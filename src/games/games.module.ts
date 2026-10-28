import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GameEngineService } from './game-engine.service';

@Module({
  controllers: [GamesController],
  providers: [GamesService, GameEngineService],
  exports: [GamesService, GameEngineService],
})
export class GamesModule {}
