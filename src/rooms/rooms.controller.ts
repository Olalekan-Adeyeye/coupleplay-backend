import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private roomsService: RoomsService) {}

  @Post()
  create(
    @Req() req: any,
    @Body() body: { coupleId: string; gameType: string; totalRounds?: number },
  ) {
    return this.roomsService.createRoom(
      body.coupleId,
      body.gameType,
      body.totalRounds ?? 5,
    );
  }

  @Get('active/:coupleId')
  getActive(@Param('coupleId') coupleId: string) {
    return this.roomsService.getActiveRoom(coupleId);
  }

  @Get(':id')
  getRoom(@Param('id') id: string, @Req() req: any) {
    return this.roomsService.getRoom(id, req.user.id);
  }

  @Post(':id/join')
  joinRoom(@Param('id') id: string, @Req() req: any) {
    return this.roomsService.joinRoom(id, req.user.id);
  }

  @Post(':id/ready')
  ready(@Param('id') id: string, @Req() req: any) {
    return this.roomsService.playerReady(id, req.user.id);
  }
}
