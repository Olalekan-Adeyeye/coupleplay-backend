import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class CouplesService {
  constructor(private prisma: PrismaService) {}

  async getMyCouple(userId: string) {
    const couple = await this.prisma.couple.findFirst({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: {
        userA: true,
        userB: true,
      },
    });

    return couple;
  }

  async generateInviteCode(userId: string) {
    const existing = await this.getMyCouple(userId);
    if (existing?.userBId) {
      throw new ConflictException('Already in a couple');
    }

    // If user has a stale couple with no partner, reuse it
    if (existing) {
      const code = randomUUID().slice(0, 8).toUpperCase();
      return this.prisma.couple.update({
        where: { id: existing.id },
        data: { inviteCode: code },
      });
    }

    const code = randomUUID().slice(0, 8).toUpperCase();

    const couple = await this.prisma.couple.create({
      data: {
        userAId: userId,
        inviteCode: code,
      },
    });

    return couple;
  }

  async joinByInviteCode(userId: string, code: string) {
    const existing = await this.getMyCouple(userId);
    if (existing?.userBId) {
      throw new ConflictException('Already in a couple');
    }

    const couple = await this.prisma.couple.findFirst({
      where: { inviteCode: code },
    });

    if (!couple) {
      throw new NotFoundException('Invalid invite code');
    }

    if (couple.userAId === userId) {
      throw new ConflictException('Cannot join your own invite');
    }

    if (couple.userBId) {
      throw new ForbiddenException('This couple is already full');
    }

    // If the joining user has a stale couple record, delete it first
    if (existing) {
      await this.prisma.couple.delete({ where: { id: existing.id } });
    }

    return this.prisma.couple.update({
      where: { id: couple.id },
      data: {
        userBId: userId,
        inviteCode: null,
      },
      include: {
        userA: true,
        userB: true,
      },
    });
  }

  async unlink(userId: string) {
    const couple = await this.getMyCouple(userId);
    if (!couple) {
      throw new NotFoundException('No partner linked');
    }

    // Soft-unlink: set userBId to null, restore invite code for userA
    await this.prisma.couple.update({
      where: { id: couple.id },
      data: {
        userBId: null,
        inviteCode: randomUUID().slice(0, 8).toUpperCase(),
      },
    });

    return { ok: true };
  }
}
