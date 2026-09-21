import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const GAME_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  TIC_TAC_TOE: { icon: 'grid', color: '#10B981', bg: '#E8F8EF' },
  SPEED_BATTLE: { icon: 'lightning-bolt', color: '#F59E0B', bg: '#FEF3C7' },
  NUMBER_HUNT: { icon: 'hexagon', color: '#8B5CF6', bg: '#EDE9FE' },
};

const DEFAULT_GAME_ICON = { icon: 'gamepad-variant', color: '#946BFF', bg: '#EFEAFF' };

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getOverview(coupleId: string, userId: string) {
    const rooms = await this.prisma.gameRoom.findMany({
      where: { coupleId, status: 'FINISHED' },
      include: { players: true },
      orderBy: { finishedAt: 'desc' },
    });

    const totalGames = rooms.length;

    let wins = 0;
    let losses = 0;
    let draws = 0;
    let xp = 0;

    for (const room of rooms) {
      const userPlayer = room.players.find((p) => p.userId === userId);
      const partnerPlayer = room.players.find((p) => p.userId !== userId);

      if (userPlayer) xp += userPlayer.score;

      if (userPlayer && partnerPlayer) {
        if (userPlayer.score > partnerPlayer.score) wins++;
        else if (userPlayer.score < partnerPlayer.score) losses++;
        else draws++;
      }
    }

    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

    const streak = this.calculateStreak(rooms, userId);

    return {
      streak,
      totalGames,
      wins,
      losses,
      draws,
      winRate,
      xp,
    };
  }

  async getActivity(coupleId: string, userId: string, partnerName: string) {
    const rooms = await this.prisma.gameRoom.findMany({
      where: { coupleId, status: 'FINISHED' },
      include: { players: true },
      orderBy: { finishedAt: 'desc' },
      take: 50,
    });

    const grouped: Record<string, any[]> = {};

    for (const room of rooms) {
      const finishedAt = room.finishedAt ? new Date(room.finishedAt) : new Date();
      const dayKey = this.getDayKey(finishedAt);

      if (!grouped[dayKey]) grouped[dayKey] = [];

      const userPlayer = room.players.find((p) => p.userId === userId);
      const partnerPlayer = room.players.find((p) => p.userId !== userId);

      const gameInfo = GAME_ICONS[room.gameType] || DEFAULT_GAME_ICON;
      let title = '';
      let icon = gameInfo.icon;
      let color = gameInfo.color;
      let bg = gameInfo.bg;

      if (userPlayer && partnerPlayer) {
        if (userPlayer.score > partnerPlayer.score) {
          title = `You won ${this.formatGameType(room.gameType)}`;
          icon = 'trophy-outline';
          color = '#8A4BE0';
          bg = '#EFEAFF';
        } else if (userPlayer.score < partnerPlayer.score) {
          title = `${partnerName} won ${this.formatGameType(room.gameType)}`;
          icon = 'trophy-outline';
          color = '#FF69B4';
          bg = '#FFE4F1';
        } else {
          title = `${this.formatGameType(room.gameType)} draw!`;
          icon = 'handshake';
          color = '#F59E0B';
          bg = '#FEF3C7';
        }
      }

      const timeStr = finishedAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      grouped[dayKey].push({
        id: room.id,
        title,
        xp: `+${userPlayer?.score ?? 0} XP`,
        time: timeStr,
        icon,
        color,
        bg,
        gameType: room.gameType,
      });
    }

    const now = new Date();
    const result = [];

    if (grouped['Today']) {
      result.push({ day: 'Today', items: grouped['Today'] });
    }

    if (grouped['Yesterday']) {
      result.push({ day: 'Yesterday', items: grouped['Yesterday'] });
    }

    const thisWeek: any[] = [];
    const earlier: any[] = [];

    for (const [key, items] of Object.entries(grouped)) {
      if (key === 'Today' || key === 'Yesterday') continue;

      const date = new Date(key);
      const daysDiff = Math.floor((now.getTime() - date.getTime()) / 86400000);

      if (daysDiff < 7) {
        thisWeek.push(...items);
      } else {
        earlier.push(...items);
      }
    }

    if (thisWeek.length > 0) {
      result.push({ day: 'This Week', items: thisWeek });
    }

    if (earlier.length > 0) {
      result.push({ day: 'Earlier', items: earlier });
    }

    return result;
  }

  async getAchievements(coupleId: string, userId: string) {
    const rooms = await this.prisma.gameRoom.findMany({
      where: { coupleId, status: 'FINISHED' },
      include: { players: true, rounds: true },
      orderBy: { finishedAt: 'desc' },
    });

    const overview = await this.getOverview(coupleId, userId);
    const winStreak = this.calculateWinStreak(rooms, userId);

    let perfectGames = 0;
    const gameTypesPlayed = new Set<string>();
    let nightOwl = false;
    let earlyBird = false;
    let weekendWarrior = false;

    for (const room of rooms) {
      const userPlayer = room.players.find((p) => p.userId === userId);
      const partnerPlayer = room.players.find((p) => p.userId !== userId);

      gameTypesPlayed.add(room.gameType);

      if (room.finishedAt) {
        const finishedDate = new Date(room.finishedAt);
        const hour = finishedDate.getHours();
        const day = finishedDate.getDay();

        if (hour >= 0 && hour < 5) nightOwl = true;
        if (hour >= 5 && hour < 8) earlyBird = true;
        if (day === 0 || day === 6) weekendWarrior = true;
      }

      if (userPlayer && partnerPlayer && userPlayer.score > partnerPlayer.score) {
        const userRoundsWon = room.rounds.filter((r) => {
          if (!r.data) return false;
          try {
            const data = JSON.parse(r.data);
            return data.winnerId === userId;
          } catch {
            return false;
          }
        }).length;

        if (userRoundsWon === room.totalRounds) {
          perfectGames++;
        }
      }
    }

    const allAchievements = [
      // Milestones
      {
        id: 'first_game',
        name: 'First Game',
        description: 'Play your first game together',
        icon: 'star-outline',
        color: '#F59E0B',
        category: 'milestone',
        condition: overview.totalGames >= 1,
        progress: Math.min(100, overview.totalGames * 100),
        unlockedAt: rooms.length > 0 ? rooms[rooms.length - 1].finishedAt?.toISOString() ?? null : null,
      },
      {
        id: 'game_night',
        name: 'Game Night',
        description: 'Play 10 games together',
        icon: 'gamepad-variant',
        color: '#8A4BE0',
        category: 'milestone',
        condition: overview.totalGames >= 10,
        progress: Math.min(100, (overview.totalGames / 10) * 100),
        unlockedAt: overview.totalGames >= 10 ? this.findUnlockDate(rooms, 10) : null,
      },
      {
        id: 'century_club',
        name: 'Century Club',
        description: 'Play 50 games together',
        icon: 'trophy',
        color: '#22C55E',
        category: 'milestone',
        condition: overview.totalGames >= 50,
        progress: Math.min(100, (overview.totalGames / 50) * 100),
        unlockedAt: overview.totalGames >= 50 ? this.findUnlockDate(rooms, 50) : null,
      },
      {
        id: 'legendary',
        name: 'Legendary',
        description: 'Play 100 games together',
        icon: 'crown',
        color: '#F59E0B',
        category: 'milestone',
        condition: overview.totalGames >= 100,
        progress: Math.min(100, (overview.totalGames / 100) * 100),
        unlockedAt: overview.totalGames >= 100 ? this.findUnlockDate(rooms, 100) : null,
      },
      {
        id: 'on_fire',
        name: 'On Fire',
        description: 'Win 3 games in a row',
        icon: 'fire',
        color: '#F59E0B',
        category: 'milestone',
        condition: winStreak >= 3,
        progress: Math.min(100, (winStreak / 3) * 100),
        unlockedAt: winStreak >= 3 ? rooms[0]?.finishedAt?.toISOString() ?? null : null,
      },
      {
        id: 'unstoppable',
        name: 'Unstoppable',
        description: 'Win 7 games in a row',
        icon: 'fire',
        color: '#EF4444',
        category: 'milestone',
        condition: winStreak >= 7,
        progress: Math.min(100, (winStreak / 7) * 100),
        unlockedAt: winStreak >= 7 ? rooms[0]?.finishedAt?.toISOString() ?? null : null,
      },
      {
        id: 'xp_hunter',
        name: 'XP Hunter',
        description: 'Earn 100 XP',
        icon: 'lightning-bolt',
        color: '#F59E0B',
        category: 'milestone',
        condition: overview.xp >= 100,
        progress: Math.min(100, (overview.xp / 100) * 100),
        unlockedAt: overview.xp >= 100 ? this.findUnlockDateByXp(rooms, userId, 100) : null,
      },
      {
        id: 'xp_master',
        name: 'XP Master',
        description: 'Earn 500 XP',
        icon: 'lightning-bolt',
        color: '#8A4BE0',
        category: 'milestone',
        condition: overview.xp >= 500,
        progress: Math.min(100, (overview.xp / 500) * 100),
        unlockedAt: overview.xp >= 500 ? this.findUnlockDateByXp(rooms, userId, 500) : null,
      },
      {
        id: 'xp_legend',
        name: 'XP Legend',
        description: 'Earn 1000 XP',
        icon: 'lightning-bolt',
        color: '#FF69B4',
        category: 'milestone',
        condition: overview.xp >= 1000,
        progress: Math.min(100, (overview.xp / 1000) * 100),
        unlockedAt: overview.xp >= 1000 ? this.findUnlockDateByXp(rooms, userId, 1000) : null,
      },
      // Win milestones
      {
        id: 'rookie_winner',
        name: 'Rookie Winner',
        description: 'Win your first game',
        icon: 'trophy-outline',
        color: '#22C55E',
        category: 'milestone',
        condition: overview.wins >= 1,
        progress: Math.min(100, overview.wins * 100),
        unlockedAt: overview.wins >= 1 ? this.findNthWinDate(rooms, userId, 1) : null,
      },
      {
        id: 'sharpshooter',
        name: 'Sharpshooter',
        description: 'Win 10 games',
        icon: 'crosshairs',
        color: '#F59E0B',
        category: 'milestone',
        condition: overview.wins >= 10,
        progress: Math.min(100, (overview.wins / 10) * 100),
        unlockedAt: overview.wins >= 10 ? this.findNthWinDate(rooms, userId, 10) : null,
      },
      {
        id: 'champion',
        name: 'Champion',
        description: 'Win 25 games',
        icon: 'crown',
        color: '#8A4BE0',
        category: 'milestone',
        condition: overview.wins >= 25,
        progress: Math.min(100, (overview.wins / 25) * 100),
        unlockedAt: overview.wins >= 25 ? this.findNthWinDate(rooms, userId, 25) : null,
      },
      {
        id: 'dominator',
        name: 'Dominator',
        description: 'Win 50 games',
        icon: 'shield-crown',
        color: '#EF4444',
        category: 'milestone',
        condition: overview.wins >= 50,
        progress: Math.min(100, (overview.wins / 50) * 100),
        unlockedAt: overview.wins >= 50 ? this.findNthWinDate(rooms, userId, 50) : null,
      },
      // Special
      {
        id: 'night_owl',
        name: 'Night Owl',
        description: 'Play a game after midnight',
        icon: 'weather-night',
        color: '#8C78FF',
        category: 'special',
        condition: nightOwl,
        progress: nightOwl ? 100 : 0,
        unlockedAt: nightOwl ? this.findSpecialUnlockDate(rooms, 'night') : null,
      },
      {
        id: 'early_bird',
        name: 'Early Bird',
        description: 'Play a game before 8am',
        icon: 'weather-sunny',
        color: '#F59E0B',
        category: 'special',
        condition: earlyBird,
        progress: earlyBird ? 100 : 0,
        unlockedAt: earlyBird ? this.findSpecialUnlockDate(rooms, 'early') : null,
      },
      {
        id: 'weekend_warrior',
        name: 'Weekend Warrior',
        description: 'Play a game on the weekend',
        icon: 'calendar-star',
        color: '#8A4BE0',
        category: 'special',
        condition: weekendWarrior,
        progress: weekendWarrior ? 100 : 0,
        unlockedAt: weekendWarrior ? this.findSpecialUnlockDate(rooms, 'weekend') : null,
      },
      {
        id: 'perfect_match',
        name: 'Perfect Match',
        description: 'Win a game without losing a round',
        icon: 'cards-heart',
        color: '#FF69B4',
        category: 'special',
        condition: perfectGames > 0,
        progress: perfectGames > 0 ? 100 : 0,
        unlockedAt: perfectGames > 0 ? this.findPerfectGameDate(rooms, userId) : null,
      },
      {
        id: 'game_variety',
        name: 'Game Variety',
        description: 'Play all 3 game types',
        icon: 'shape',
        color: '#22C55E',
        category: 'special',
        condition: gameTypesPlayed.size >= 3,
        progress: Math.min(100, (gameTypesPlayed.size / 3) * 100),
        unlockedAt: gameTypesPlayed.size >= 3 ? this.findVarietyUnlockDate(rooms) : null,
      },
    ];

    return allAchievements.map(({ condition, ...rest }) => ({
      ...rest,
      unlocked: condition,
    }));
  }

  private findUnlockDate(rooms: any[], targetCount: number): string | null {
    const sorted = [...rooms].reverse();
    return sorted[targetCount - 1]?.finishedAt?.toISOString() ?? null;
  }

  private findUnlockDateByXp(rooms: any[], userId: string, targetXp: number): string | null {
    let cumulativeXp = 0;
    for (const room of [...rooms].reverse()) {
      const player = room.players.find((p: any) => p.userId === userId);
      if (player) {
        cumulativeXp += player.score;
        if (cumulativeXp >= targetXp) {
          return room.finishedAt?.toISOString() ?? null;
        }
      }
    }
    return null;
  }

  private findNthWinDate(rooms: any[], userId: string, n: number): string | null {
    let wins = 0;
    for (const room of [...rooms].reverse()) {
      const userPlayer = room.players.find((p: any) => p.userId === userId);
      const partnerPlayer = room.players.find((p: any) => p.userId !== userId);
      if (userPlayer && partnerPlayer && userPlayer.score > partnerPlayer.score) {
        wins++;
        if (wins >= n) {
          return room.finishedAt?.toISOString() ?? null;
        }
      }
    }
    return null;
  }

  private findSpecialUnlockDate(rooms: any[], type: string): string | null {
    for (const room of [...rooms].reverse()) {
      if (!room.finishedAt) continue;
      const date = new Date(room.finishedAt);
      const hour = date.getHours();
      const day = date.getDay();

      if (type === 'night' && hour >= 0 && hour < 5) return date.toISOString();
      if (type === 'early' && hour >= 5 && hour < 8) return date.toISOString();
      if (type === 'weekend' && (day === 0 || day === 6)) return date.toISOString();
    }
    return null;
  }

  private findPerfectGameDate(rooms: any[], userId: string): string | null {
    for (const room of [...rooms].reverse()) {
      const userPlayer = room.players.find((p: any) => p.userId === userId);
      const partnerPlayer = room.players.find((p: any) => p.userId !== userId);
      if (!userPlayer || !partnerPlayer || userPlayer.score <= partnerPlayer.score) continue;

      const userRoundsWon = room.rounds.filter((r: any) => {
        if (!r.data) return false;
        try {
          const data = JSON.parse(r.data);
          return data.winnerId === userId;
        } catch {
          return false;
        }
      }).length;

      if (userRoundsWon === room.totalRounds) {
        return room.finishedAt?.toISOString() ?? null;
      }
    }
    return null;
  }

  private findVarietyUnlockDate(rooms: any[]): string | null {
    const gameTypes = new Set<string>();
    for (const room of [...rooms].reverse()) {
      gameTypes.add(room.gameType);
      if (gameTypes.size >= 3) {
        return room.finishedAt?.toISOString() ?? null;
      }
    }
    return null;
  }

  private calculateStreak(rooms: any[], userId: string): number {
    if (rooms.length === 0) return 0;

    const daysWithGames = new Set<string>();

    for (const room of rooms) {
      if (room.finishedAt) {
        const date = new Date(room.finishedAt);
        daysWithGames.add(date.toDateString());
      }
    }

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(today);

    while (daysWithGames.has(checkDate.toDateString())) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    return streak;
  }

  private calculateWinStreak(rooms: any[], userId: string): number {
    let streak = 0;
    for (const room of rooms) {
      const userPlayer = room.players.find((p: any) => p.userId === userId);
      const partnerPlayer = room.players.find((p: any) => p.userId !== userId);
      if (userPlayer && partnerPlayer && userPlayer.score > partnerPlayer.score) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  private getDayKey(date: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) return 'Today';
    if (dateOnly.getTime() === yesterday.getTime()) return 'Yesterday';

    return dateOnly.toISOString().split('T')[0];
  }

  private formatGameType(type: string): string {
    return type
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  }
}
