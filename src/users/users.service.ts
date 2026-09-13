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
    // Clean up couple link first
    await this.prisma.couple.updateMany({
      where: { userAId: userId },
      data: { userAId: userId, userBId: null },
    });
    await this.prisma.couple.updateMany({
      where: { userBId: userId },
      data: { userBId: null },
    });

    // Delete game data
    await this.prisma.gamePlayer.deleteMany({ where: { userId } });
    await this.prisma.gameRound.deleteMany({
      where: { room: { couple: { userAId: userId } } },
    });
    await this.prisma.gameRoom.deleteMany({
      where: { couple: { userAId: userId } },
    });

    // Delete user
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
