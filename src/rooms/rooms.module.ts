import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoomsCleanupService } from './rooms-cleanup.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RoomsService, RoomsCleanupService],
  controllers: [RoomsController],
  exports: [RoomsService],
})
export class RoomsModule {}
