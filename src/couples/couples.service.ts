import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { randomUUID } from 'crypto';
import { PUBLIC_USER_SELECT } from '../users/users.service';

const COUPLE_INCLUDE = {
  userA: { select: { ...PUBLIC_USER_SELECT, createdAt: true } },
  userB: { select: { ...PUBLIC_USER_SELECT, createdAt: true } },
} satisfies Prisma.CoupleInclude;

function newInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
}

@Injectable()
export class CouplesService {
  constructor(private prisma: PrismaService) {}

  async getMyCouple(userId: string) {
    return this.prisma.couple.findFirst({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: COUPLE_INCLUDE,
    });
  }

  async generateInviteCode(userId: string) {
    const existing = await this.getMyCouple(userId);
    if (existing?.userBId) {
      throw new ConflictException('Already in a couple');
    }

    if (existing) {
      return this.prisma.couple.update({
        where: { id: existing.id },
        data: { inviteCode: newInviteCode() },
        include: COUPLE_INCLUDE,
      });
    }

    return this.prisma.couple.create({
      data: {
        userAId: userId,
        inviteCode: newInviteCode(),
      },
      include: COUPLE_INCLUDE,
    });
  }

  async joinByInviteCode(userId: string, code: string) {
    const existing = await this.getMyCouple(userId);
    if (existing?.userBId) {
      throw new ConflictException('Already in a couple');
    }

    return this.prisma.$transaction(async (tx) => {
      const couple = await tx.couple.findFirst({ where: { inviteCode: code } });
      if (!couple) throw new NotFoundException('Invalid invite code');
      if (couple.userAId === userId) {
        throw new ConflictException('Cannot join your own invite');
      }
      if (couple.userBId) {
        throw new ForbiddenException('This couple is already full');
      }

      if (existing) {
        await this.deleteCoupleWithData(tx, existing.id);
      }

      const claimed = await tx.couple.updateMany({
        where: { id: couple.id, userBId: null },
        data: { userBId: userId, inviteCode: null },
      });
      if (claimed.count === 0) {
        throw new ForbiddenException('This couple is already full');
      }

      return tx.couple.findUnique({
        where: { id: couple.id },
        include: COUPLE_INCLUDE,
      });
    });
  }

  async unlink(userId: string) {
    const couple = await this.getMyCouple(userId);
    if (!couple) {
      throw new NotFoundException('No partner linked');
    }

    await this.prisma.couple.update({
      where: { id: couple.id },
      data: { userBId: null, inviteCode: newInviteCode() },
    });

    return { ok: true };
  }

  /** Couples are containers for game data, so rooms/players/rounds go first. */
  private async deleteCoupleWithData(
    tx: Prisma.TransactionClient,
    coupleId: string,
  ) {
    const rooms = await tx.gameRoom.findMany({
      where: { coupleId },
      select: { id: true },
    });
    const roomIds = rooms.map((room) => room.id);
    if (roomIds.length > 0) {
      await tx.gamePlayer.deleteMany({ where: { roomId: { in: roomIds } } });
      await tx.gameRound.deleteMany({ where: { roomId: { in: roomIds } } });
      await tx.gameRoom.deleteMany({ where: { coupleId } });
    }
    await tx.couple.delete({ where: { id: coupleId } });
  }
}
