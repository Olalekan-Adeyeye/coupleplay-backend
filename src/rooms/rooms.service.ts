import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async createRoom(coupleId: string, gameType: string, totalRounds: number) {
    return this.prisma.gameRoom.create({
      data: {
        coupleId,
        gameType,
        totalRounds,
        status: 'WAITING',
        currentRound: 0,
      },
    });
  }

  async getRoom(roomId: string, userId: string) {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: {
        couple: true,
        players: true,
        rounds: true,
      },
    });

    if (!room) throw new NotFoundException('Room not found');

    const isMember =
      room.couple.userAId === userId || room.couple.userBId === userId;
    if (!isMember) throw new ForbiddenException('Not in this room');

    return room;
  }

  async getActiveRoom(coupleId: string, gameType?: string) {
    return this.prisma.gameRoom.findFirst({
      where: {
        coupleId,
        status: { in: ['WAITING', 'READY', 'IN_PROGRESS'] },
        ...(gameType ? { gameType } : {}),
      },
    });
  }

  async joinRoom(roomId: string, userId: string) {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { couple: true },
    });

    if (!room) throw new NotFoundException('Room not found');

    const isMember =
      room.couple.userAId === userId || room.couple.userBId === userId;
    if (!isMember) throw new ForbiddenException('Not in this couple');

    let player = await this.prisma.gamePlayer.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!player) {
      player = await this.prisma.gamePlayer.create({
        data: {
          roomId,
          userId,
          score: 0,
          ready: false,
          connected: true,
        },
      });
    } else {
      // Reset ready flag — player must explicitly ready up in the new session
      player = await this.prisma.gamePlayer.update({
        where: { id: player.id },
        data: { connected: true, ready: false },
      });
    }

    return player;
  }

  async playerReady(roomId: string, userId: string) {
    await this.prisma.gamePlayer.update({
      where: { roomId_userId: { roomId, userId } },
      data: { ready: true },
    });
  }

  async setRoomStatus(roomId: string, status: string) {
    const valid = ['WAITING', 'IN_PROGRESS', 'FINISHED'] as const;
    if (!valid.includes(status as any)) {
      return;
    }

    return this.prisma.gameRoom.update({
      where: { id: roomId },
      data: { status: status as any },
    });
  }

  async setConnected(roomId: string, userId: string, connected: boolean) {
    try {
      await this.prisma.gamePlayer.update({
        where: { roomId_userId: { roomId, userId } },
        data: { connected },
      });
    } catch {
      // Player record may not exist yet — safe to ignore
    }
  }
}
