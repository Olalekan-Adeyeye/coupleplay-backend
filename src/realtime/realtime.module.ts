import { Module } from '@nestjs/common';
import { RoomsModule } from '../rooms/rooms.module';
import { GameGateway } from './game.gateway';

@Module({
  imports: [RoomsModule],
  providers: [GameGateway],
  exports: [GameGateway],
})
export class RealtimeModule {}
