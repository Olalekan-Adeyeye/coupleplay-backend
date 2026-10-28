import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const VALID_STATUSES = ['WAITING', 'IN_PROGRESS', 'FINISHED'] as const;

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async createRoom(coupleId: string, gameType: string, totalRounds: number, userId: string) {
    const couple = await this.prisma.couple.findUnique({ where: { id: coupleId } });
    if (!couple) throw new NotFoundException('Couple not found');
    if (couple.userAId !== userId && couple.userBId !== userId) {
      throw new ForbiddenException('Not a member of this couple');
    }

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

  async assertRoomMembership(roomId: string, userId: string) {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      select: { couple: { select: { userAId: true, userBId: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');

    const { userAId, userBId } = room.couple;
    if (userAId !== userId && userBId !== userId) {
      throw new ForbiddenException('Not in this room');
    }
  }

  async getRoom(roomId: string, userId: string) {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: {
        couple: true,
        players: true,
        rounds: {
          select: {
            id: true,
            roundNumber: true,
            state: true,
            startedAt: true,
            endedAt: true,
          },
          orderBy: { roundNumber: 'asc' },
        },
      },
    });

    if (!room) throw new NotFoundException('Room not found');

    const isMember =
      room.couple.userAId === userId || room.couple.userBId === userId;
    if (!isMember) throw new ForbiddenException('Not in this room');

    return room;
  }

  async getActiveRoom(userId: string, gameType?: string) {
    const couple = await this.prisma.couple.findFirst({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true },
    });
    if (!couple) return null;

    return this.prisma.gameRoom.findFirst({
      where: {
        coupleId: couple.id,
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

    const player = await this.prisma.gamePlayer.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!player) {
      return this.prisma.gamePlayer.create({
        data: {
          roomId,
          userId,
          score: 0,
          ready: false,
          connected: true,
        },
      });
    }

    // Reset ready flag — player must explicitly ready up in the new session
    return this.prisma.gamePlayer.update({
      where: { id: player.id },
      data: { connected: true, ready: false },
    });
  }

  async playerReady(roomId: string, userId: string) {
    try {
      return await this.prisma.gamePlayer.update({
        where: { roomId_userId: { roomId, userId } },
        data: { ready: true },
      });
    } catch {
      throw new NotFoundException('You are not a player in this room');
    }
  }

  async setRoomStatus(roomId: string, status: string) {
    if (!VALID_STATUSES.includes(status as any)) {
      throw new BadRequestException(`Invalid room status: ${status}`);
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
