import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

/**
 * Periodically finishes orphaned rooms so they don't block new room creation.
 * - WAITING rooms older than 5 minutes → FINISHED
 * - IN_PROGRESS rooms older than 30 minutes → FINISHED
 */
@Injectable()
export class RoomsCleanupService {
  private readonly logger = new Logger(RoomsCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/5 * * * *')
  async handleCleanup() {
    const now = new Date();

    // Expire stale WAITING rooms (>5 min old)
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const staleWaiting = await this.prisma.gameRoom.updateMany({
      where: {
        status: 'WAITING',
        createdAt: { lt: fiveMinAgo },
      },
      data: { status: 'FINISHED', finishedAt: now },
    });
    if (staleWaiting.count > 0) {
      this.logger.log(`Cleaned up ${staleWaiting.count} stale WAITING rooms`);
    }

    // Expire abandoned IN_PROGRESS rooms (>30 min old)
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const staleInProgress = await this.prisma.gameRoom.updateMany({
      where: {
        status: 'IN_PROGRESS',
        createdAt: { lt: thirtyMinAgo },
      },
      data: { status: 'FINISHED', finishedAt: now },
    });
    if (staleInProgress.count > 0) {
      this.logger.log(`Cleaned up ${staleInProgress.count} stale IN_PROGRESS rooms`);
    }
  }
}
