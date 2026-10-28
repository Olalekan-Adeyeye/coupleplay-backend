import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';
import { CouplesService } from '../couples/couples.service';
import { GameEngineService, ActionOutcome } from '../games/game-engine.service';
import { GameStateBase } from '../games/game.types';
import { resolveAllowedOrigins } from '../common/config/origins';

@WebSocketGateway({
  cors: { origin: resolveAllowedOrigins(process.env), credentials: true },
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private userSockets = new Map<string, Set<string>>();
  private destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private speedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private huntTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly disconnectGraceMs = 15_000;

  constructor(
    private roomsService: RoomsService,
    private couplesService: CouplesService,
    private engineService: GameEngineService,
    private jwtService: JwtService,
  ) {}

  /* ── Connection lifecycle ────────────────────────────────────── */

  handleConnection(client: Socket) {}

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;

    if (userId) {
      const sockets = this.userSockets.get(userId);
      sockets?.delete(client.id);
      if (sockets && sockets.size === 0) this.userSockets.delete(userId);
    }

    const rooms = Array.from(client.rooms).filter((roomId) => roomId !== client.id);

    for (const roomId of rooms) {
      if (userId) {
        this.roomsService.setConnected(roomId, userId, false).catch(() => {});
        const hasOtherSocket = this.userSockets.has(userId);
        if (!hasOtherSocket) this.scheduleDestruction(roomId);
      }
    }
  }

  /* ── Auth ────────────────────────────────────────────────────── */

  @SubscribeMessage('authenticate')
  async handleAuth(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token?: string },
  ) {
    const token = data?.token;
    if (!token) {
      client.emit('authenticated', { ok: false, error: 'No credentials' });
      return;
    }

    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync(token);
      userId = payload.sub;
    } catch {
      client.emit('authenticated', { ok: false, error: 'Invalid token' });
      return;
    }

    if (typeof client.data.userId === 'string' && client.data.userId !== userId) {
      client.emit('authenticated', { ok: false, error: 'Socket already bound' });
      return;
    }

    client.data.userId = userId;
    client.join(`user:${userId}`);

    const sockets = this.userSockets.get(userId) ?? new Set<string>();
    sockets.add(client.id);
    this.userSockets.set(userId, sockets);

    client.emit('authenticated', { ok: true, userId });
  }

  private requireUserId(client: Socket): string | null {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.emit('game:reject', { reason: 'Not authenticated' });
    }
    return userId ?? null;
  }

  /* ── Room management ─────────────────────────────────────────── */

  @SubscribeMessage('room:create')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { coupleId: string; gameType: string; totalRounds?: number },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    try {
      const room = await this.roomsService.createRoom(
        data.coupleId,
        data.gameType,
        data.totalRounds ?? 5,
        userId,
      );
      client.join(room.id);
      client.emit('room:created', room);
    } catch (err) {
      client.emit('game:reject', { reason: (err as Error).message });
    }
  }

  @SubscribeMessage('room:join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    try {
      await this.roomsService.joinRoom(data.roomId, userId);
    } catch (err) {
      client.emit('game:reject', { reason: (err as Error).message });
      return;
    }
    this.cancelDestruction(data.roomId);
    client.join(data.roomId);

    await this.roomsService.setConnected(data.roomId, userId, true);

    this.server.to(data.roomId).emit('room:player_joined', {
      roomId: data.roomId,
      userId,
    });
    this.server.to(data.roomId).emit('player:presence', {
      socketId: client.id,
      userId,
      connected: true,
    });

    const ready = await this.hasBothPlayers(data.roomId);
    if (ready) {
      this.server.to(data.roomId).emit('room:ready', {
        roomId: data.roomId,
        message: 'Both players joined',
      });
    }
  }

  @SubscribeMessage('room:leave')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    client.leave(data.roomId);
    this.server.to(data.roomId).emit('room:player_left', {
      roomId: data.roomId,
      userId,
    });

    this.roomsService.setConnected(data.roomId, userId, false).catch(() => {});
    this.destroyRoom(data.roomId);
  }

  /* ── Ready + Game start ──────────────────────────────────────── */

  @SubscribeMessage('player:ready')
  async handlePlayerReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    try {
      await this.roomsService.assertRoomMembership(data.roomId, userId);
      await this.roomsService.playerReady(data.roomId, userId);
    } catch (err) {
      client.emit('game:reject', { reason: (err as Error).message });
      return;
    }

    this.server.to(data.roomId).emit('player:status', {
      userId,
      ready: true,
    });

    const room = await this.roomsService.getRoom(data.roomId, userId);
    const allReady =
      room.players.length === 2 && room.players.every((p) => p.ready);

    if (allReady && room.status === 'WAITING') {
      const state = await this.engineService.startGame(data.roomId);
      await this.broadcastGameState(data.roomId, state);
      this.server.to(data.roomId).emit('game:start', { roomId: data.roomId });
      if (state.gameType === 'SPEED_BATTLE') {
        this.scheduleTimersFor(data.roomId, state);
      }
      if (state.gameType === 'NUMBER_HUNT') {
        this.scheduleTimersFor(data.roomId, state);
      }
    }
  }

  /* ── Gameplay ────────────────────────────────────────────────── */

  @SubscribeMessage('game:action')
  async handleGameAction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; action: string; payload?: any },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    try {
      await this.roomsService.assertRoomMembership(data.roomId, userId);
    } catch {
      client.emit('game:reject', { reason: 'Not in this room' });
      return;
    }

    const outcome = await this.engineService
      .handleAction(data.roomId, userId, { action: data.action, payload: data.payload })
      .catch(() => null);

    if (!outcome?.changed) {
      client.emit('game:reject', { reason: 'Move rejected' });
      return;
    }

    await this.broadcastOutcome(data.roomId, outcome);
  }

  // Client-side safety net if a server timer was lost (e.g. after a
  // restart) — the engine validates that the deadline really passed.
  @SubscribeMessage('game:timeout')
  async handleClientTimeout(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    try {
      await this.roomsService.assertRoomMembership(data.roomId, userId);
    } catch {
      return;
    }

    await this.runTimeout(data.roomId);
  }

  @SubscribeMessage('game:sync')
  async handleSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    const state = await this.engineService.getCurrentState(data.roomId);
    if (!state) return;

    try {
      await this.roomsService.assertRoomMembership(data.roomId, userId);
    } catch {
      return;
    }

    client.emit('game:state', this.engineService.sanitizeForViewer(userId, state));
  }

  /* ── Reactions ───────────────────────────────────────────────── */

  @SubscribeMessage('player:reaction')
  handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; reaction: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;

    client.to(data.roomId).emit('player:reaction', { userId, reaction: data.reaction });
  }

  /* ── Couple link events (server-resolved, partner-scoped) ────── */

  @SubscribeMessage('couples:unlink')
  async handleUnlink(@ConnectedSocket() client: Socket) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    const couple = await this.couplesService.getMyCouple(userId);
    if (!couple) return;

    const partner = couple.userAId === userId ? couple.userBId : couple.userAId;
    if (partner) {
      this.server.to(`user:${partner}`).emit('couple:unlinked', {
        byUserId: userId,
        coupleId: couple.id,
      });
    }
  }

  @SubscribeMessage('couples:joined')
  async handleJoined(
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.requireUserId(client);
    if (!userId) return;

    const couple = await this.couplesService.getMyCouple(userId);
    if (!couple) return;

    const partner = couple.userAId === userId ? couple.userBId : couple.userAId;
    if (partner) {
      this.server.to(`user:${partner}`).emit('couple:linked', { coupleId: couple.id });
    }
  }

  /* ── Outcome broadcast ───────────────────────────────────────── */

  private playerIds(state: GameStateBase): string[] {
    return Object.keys(state.scores);
  }

  private async broadcastGameState(roomId: string, state: GameStateBase) {
    for (const userId of this.playerIds(state)) {
      this.server.to(`user:${userId}`).emit('game:state', this.engineService.sanitizeForViewer(userId, state));
    }
  }

  private async broadcastOutcome(roomId: string, outcome: ActionOutcome) {
    await this.broadcastGameState(roomId, outcome.state);

    if (outcome.roundEnded) {
      for (const userId of this.playerIds(outcome.state)) {
        const reveal = outcome.endedState
          ? this.engineService.sanitizeForViewer(userId, outcome.endedState)
          : null;
        this.server.to(`user:${userId}`).emit('game:round_end', {
          roomId,
          roundNumber: outcome.endedRoundNumber,
          winnerId: outcome.roundWinnerId,
          reveal,
        });
      }
    }

    if (outcome.finished && outcome.results) {
      this.server.to(roomId).emit('game:finished', {
        roomId,
        results: outcome.results,
      });
    }

    if (!outcome.finished) {
      this.scheduleTimersFor(roomId, outcome.state);
    }
  }

  /* ── Timers ──────────────────────────────────────────────────── */

  private currentDeadline(state: GameStateBase): number | null {
    if (state.gameType === 'SPEED_BATTLE') {
      const deadline = (state as { questionDeadline?: number | null }).questionDeadline;
      return deadline ?? null;
    }
    if (state.gameType === 'NUMBER_HUNT') {
      const ns = state as unknown as { mode: string | null; roundDeadline: number | null; callDeadline: number | null };
      return ns.mode === 'race' ? ns.callDeadline : ns.roundDeadline;
    }
    return null;
  }

  private scheduleTimersFor(roomId: string, state: GameStateBase) {
    this.clearSpeedBattleTimer(roomId);
    this.clearNumberHuntTimer(roomId);

    const deadline = this.currentDeadline(state);
    if (deadline === null) return;

    const isSpeed = state.gameType === 'SPEED_BATTLE';
    const timers = isSpeed ? this.speedTimers : this.huntTimers;
    const delay = Math.max(0, deadline - Date.now());

    const timer = setTimeout(async () => {
      timers.delete(roomId);
      await this.runTimeout(roomId);
    }, delay);

    timers.set(roomId, timer);
  }

  private async runTimeout(roomId: string) {
    const outcome = await this.engineService.handleTimeout(roomId).catch(() => null);
    if (!outcome?.changed) return;
    await this.broadcastOutcome(roomId, outcome);
  }

  private clearSpeedBattleTimer(roomId: string) {
    const timer = this.speedTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.speedTimers.delete(roomId);
    }
  }

  private clearNumberHuntTimer(roomId: string) {
    const timer = this.huntTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.huntTimers.delete(roomId);
    }
  }

  /* ── Room destruction with reconnect grace ───────────────────── */

  private scheduleDestruction(roomId: string) {
    if (this.destroyTimers.has(roomId)) return;
    const timer = setTimeout(async () => {
      this.destroyTimers.delete(roomId);
      const sockets = await this.server.in(roomId).fetchSockets();
      if (sockets.length === 0) this.destroyRoom(roomId);
    }, this.disconnectGraceMs);
    this.destroyTimers.set(roomId, timer);
  }

  private cancelDestruction(roomId: string) {
    const timer = this.destroyTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.destroyTimers.delete(roomId);
    }
  }

  private async hasBothPlayers(roomId: string): Promise<boolean> {
    const sockets = await this.server.in(roomId).fetchSockets();
    const userIds = new Set(sockets.map((s) => (s.data as { userId?: string }).userId).filter(Boolean));
    return userIds.size >= 2;
  }

  private async destroyRoom(roomId: string) {
    this.cancelDestruction(roomId);
    this.clearSpeedBattleTimer(roomId);
    this.clearNumberHuntTimer(roomId);
    this.engineService.dropLive(roomId);

    try {
      await this.roomsService.setRoomStatus(roomId, 'FINISHED');
    } catch {}

    this.server.to(roomId).emit('game:abandoned', {
      roomId,
      reason: 'Partner disconnected',
    });
  }
}
