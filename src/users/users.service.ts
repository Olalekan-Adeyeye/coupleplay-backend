import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async deleteAccount(userId: string) {
    // Delete game players for this user (references User directly)
    await this.prisma.gamePlayer.deleteMany({ where: { userId } });

    // Find all couples this user is involved in
    const couples = await this.prisma.couple.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });

    // Delete game rounds and rooms for each couple (manual cascade)
    for (const couple of couples) {
      await this.prisma.gameRound.deleteMany({
        where: { room: { coupleId: couple.id } },
      });
      await this.prisma.gameRoom.deleteMany({
        where: { coupleId: couple.id },
      });
    }

    // Delete the couple records
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
