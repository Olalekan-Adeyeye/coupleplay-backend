import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, name: true, avatar: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      select: { id: true, email: true, username: true, name: true, avatar: true, createdAt: true, updatedAt: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, name: true, avatar: true, createdAt: true, updatedAt: true },
    });
  }

  async deleteAccount(userId: string) {
    // Find all couples this user is involved in
    const couples = await this.prisma.couple.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });

    for (const couple of couples) {
      // Delete game players in this couple's rooms first (FK on roomId)
      const rooms = await this.prisma.gameRoom.findMany({
        where: { coupleId: couple.id },
        select: { id: true },
      });
      const roomIds = rooms.map((r) => r.id);

      if (roomIds.length > 0) {
        await this.prisma.gamePlayer.deleteMany({
          where: { roomId: { in: roomIds } },
        });
        await this.prisma.gameRound.deleteMany({
          where: { roomId: { in: roomIds } },
        });
        await this.prisma.gameRoom.deleteMany({
          where: { coupleId: couple.id },
        });
      }
    }

    // Delete couple records
    await this.prisma.couple.deleteMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });

    // Finally delete the user
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }

  async updateMe(userId: string, data: { avatar?: string }) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(data.avatar !== undefined && { avatar: data.avatar }) },
    });
    return updated;
  }
}
