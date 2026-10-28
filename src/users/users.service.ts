import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  name: true,
  avatar: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...PUBLIC_USER_SELECT, createdAt: true, updatedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, data: { avatar?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...(data.avatar !== undefined && { avatar: data.avatar }) },
      select: { ...PUBLIC_USER_SELECT, createdAt: true, updatedAt: true },
    });
  }

  async deleteAccount(userId: string) {
    const couples = await this.prisma.couple.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const couple of couples) {
        const rooms = await tx.gameRoom.findMany({
          where: { coupleId: couple.id },
          select: { id: true },
        });
        const roomIds = rooms.map((room) => room.id);
        if (roomIds.length === 0) continue;

        await tx.gamePlayer.deleteMany({ where: { roomId: { in: roomIds } } });
        await tx.gameRound.deleteMany({ where: { roomId: { in: roomIds } } });
        await tx.gameRoom.deleteMany({ where: { coupleId: couple.id } });
      }

      await tx.couple.deleteMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
      });

      await tx.user.delete({ where: { id: userId } });
    });

    return { ok: true };
  }
}
