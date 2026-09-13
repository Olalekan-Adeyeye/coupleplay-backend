import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RoomsModule } from '../rooms/rooms.module';
import { GameGateway } from './game.gateway';
import { GameEngineService } from '../games/game-engine.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    RoomsModule,
    DatabaseModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    }),
  ],
  providers: [GameGateway, GameEngineService],
  exports: [GameGateway],
})
export class RealtimeModule {}
