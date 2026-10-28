import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateRoomDto } from './dto/create-room.dto';
import { GetActiveRoomQueryDto } from './dto/get-active-room-query.dto';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private roomsService: RoomsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateRoomDto) {
    return this.roomsService.createRoom(
      dto.coupleId,
      dto.gameType,
      dto.totalRounds ?? 5,
      req.user.id,
    );
  }

  @Get('active')
  getActive(@Req() req: any, @Query() query: GetActiveRoomQueryDto) {
    return this.roomsService.getActiveRoom(req.user.id, query.gameType);
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
