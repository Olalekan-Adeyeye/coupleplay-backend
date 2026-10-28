import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RoomsModule } from '../rooms/rooms.module';
import { GamesModule } from '../games/games.module';
import { CouplesModule } from '../couples/couples.module';
import { GameGateway } from './game.gateway';
import { requireJwtSecret } from '../common/config/jwt-secret';

@Module({
  imports: [
    RoomsModule,
    GamesModule,
    CouplesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
      }),
    }),
  ],
  providers: [GameGateway],
  exports: [GameGateway],
})
export class RealtimeModule {}
