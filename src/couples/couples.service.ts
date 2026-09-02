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
    if (existing) {
      throw new ConflictException('Already in a couple');
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
    if (existing) {
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
}
