import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GAME_ENGINES } from '../games/game-registry';
import { MAX_GAME_ROUNDS } from '../common/constants';

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

    if (!(gameType in GAME_ENGINES)) {
      throw new BadRequestException(`Unknown game type: ${gameType}`);
    }

    const rounds = totalRounds ?? 5;
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_GAME_ROUNDS) {
      throw new BadRequestException(`totalRounds must be between 1 and ${MAX_GAME_ROUNDS}`);
    }

    return this.prisma.gameRoom.create({
      data: {
        coupleId,
        gameType,
        totalRounds: rounds,
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

    if (player) {
      const reconnected = room.status === 'IN_PROGRESS';
      await this.prisma.gamePlayer.update({
        where: { id: player.id },
        data: { connected: true, ready: reconnected ? player.ready : false },
      });
      return { reconnected };
    }

    await this.prisma.gamePlayer.create({
      data: {
        roomId,
        userId,
        score: 0,
        ready: false,
        connected: true,
      },
    });
    return { reconnected: false };
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
