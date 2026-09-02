import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(
    private statsService: StatsService,
    private prisma: PrismaService,
  ) {}

  @Get('overview')
  async getOverview(@Req() req: any) {
    const couple = await this.prisma.couple.findFirst({
      where: {
        OR: [
          { userAId: req.user.id },
          { userBId: req.user.id },
        ],
      },
    });

    if (!couple) {
      return {
        streak: 0,
        totalGames: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        xp: 0,
      };
    }

    return this.statsService.getOverview(couple.id, req.user.id);
  }

  @Get('activity')
  async getActivity(@Req() req: any) {
    const couple = await this.prisma.couple.findFirst({
      where: {
        OR: [
          { userAId: req.user.id },
          { userBId: req.user.id },
        ],
      },
      include: {
        userA: true,
        userB: true,
      },
    });

    if (!couple) {
      return [];
    }

    const partner =
      couple.userAId === req.user.id ? couple.userB : couple.userA;
    const partnerName = partner?.name?.split(' ')[0] ?? 'Partner';

    return this.statsService.getActivity(couple.id, req.user.id, partnerName);
  }

  @Get('achievements')
  async getAchievements(@Req() req: any) {
    const couple = await this.prisma.couple.findFirst({
      where: {
        OR: [
          { userAId: req.user.id },
          { userBId: req.user.id },
        ],
      },
    });

    if (!couple) {
      return [];
    }

    return this.statsService.getAchievements(couple.id, req.user.id);
  }
}
