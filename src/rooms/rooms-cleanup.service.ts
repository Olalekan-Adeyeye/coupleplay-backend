import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { GameEngineService } from '../games/game-engine.service';

/**
 * Periodically finishes orphaned rooms so they don't block new room creation.
 * - WAITING rooms older than 5 minutes → FINISHED
 * - IN_PROGRESS rooms older than 30 minutes (since start) → FINISHED
 */
@Injectable()
export class RoomsCleanupService {
  private readonly logger = new Logger(RoomsCleanupService.name);

  constructor(
    private prisma: PrismaService,
    private engineService: GameEngineService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCleanup() {
    const now = new Date();

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

    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const staleRooms = await this.prisma.gameRoom.findMany({
      where: {
        status: 'IN_PROGRESS',
        OR: [
          { startedAt: { lt: thirtyMinAgo } },
          { startedAt: null, createdAt: { lt: thirtyMinAgo } },
        ],
      },
      select: { id: true },
    });

    if (staleRooms.length === 0) return;

    const roomIds = staleRooms.map((room) => room.id);
    await this.prisma.gameRoom.updateMany({
      where: { id: { in: roomIds } },
      data: { status: 'FINISHED', finishedAt: now },
    });
    for (const roomId of roomIds) {
      this.engineService.dropLive(roomId);
    }
    this.logger.log(`Cleaned up ${roomIds.length} stale IN_PROGRESS rooms`);
  }
}
