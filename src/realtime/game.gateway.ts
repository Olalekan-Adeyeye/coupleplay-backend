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
import { GameEngineService } from '../games/game-engine.service';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private userSockets = new Map<string, Set<string>>();

  constructor(
    private roomsService: RoomsService,
    private engineService: GameEngineService,
    private jwtService: JwtService,
  ) {}

  /* ── Connection lifecycle ────────────────────────────────────── */

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    const userId = client.data.userId as string | undefined;
    if (userId) {
      const sockets = this.userSockets.get(userId);
      sockets?.delete(client.id);
      if (sockets?.size === 0) this.userSockets.delete(userId);
    }

    const rooms = Array.from(client.rooms);
    for (const roomId of rooms) {
      if (roomId === client.id) continue;

      // Mark player disconnected in DB
      if (userId) {
        this.roomsService.setConnected(roomId, userId, false).catch(() => {});
      }

      // Immediately destroy the room — no grace period
      this.destroyRoom(roomId, userId);
    }
  }

  /* ── Auth ────────────────────────────────────────────────────── */

  @SubscribeMessage('authenticate')
  async handleAuth(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token?: string; userId?: string },
  ) {
    let userId: string | undefined;

    if (data.token) {
      try {
        const payload = await this.jwtService.verifyAsync(data.token);
        userId = payload.sub;
      } catch {
        client.emit('authenticated', { ok: false, error: 'Invalid token' });
        return;
      }
    } else if (data.userId) {
      // Dev-only fallback — reject in production
      if (process.env.NODE_ENV === 'production') {
        client.emit('authenticated', { ok: false, error: 'userId auth not allowed in production' });
        return;
      }
      userId = data.userId;
    }

    if (!userId) {
      client.emit('authenticated', { ok: false, error: 'No credentials' });
      return;
    }

    client.data.userId = userId;

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);

    client.emit('authenticated', { ok: true, userId });
  }

  /* ── Room management ─────────────────────────────────────────── */

  @SubscribeMessage('room:create')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { coupleId: string; gameType: string; totalRounds?: number },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    const room = await this.roomsService.createRoom(
      data.coupleId,
      data.gameType as any,
      data.totalRounds ?? 5,
    );
    client.join(room.id);
    client.emit('room:created', room);
    this.server.to(room.id).emit('room:player_joined', {
      roomId: room.id,
      userId,
    });
  }

  @SubscribeMessage('room:join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    await this.roomsService.joinRoom(data.roomId, userId);
    client.join(data.roomId);

    // Restore connected flag
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

    const sockets = await this.server.in(data.roomId).fetchSockets();
    if (sockets.length === 2) {
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
    const userId = client.data.userId;
    client.leave(data.roomId);

    this.server.to(data.roomId).emit('room:player_left', {
      roomId: data.roomId,
      userId,
    });

    // Mark disconnected + destroy immediately
    if (userId) {
      this.roomsService.setConnected(data.roomId, userId, false).catch(() => {});
    }
    this.destroyRoom(data.roomId, userId);
  }

  /* ── Ready + Game start ──────────────────────────────────────── */

  @SubscribeMessage('player:ready')
  async handlePlayerReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    await this.roomsService.playerReady(data.roomId, userId);
    this.server.to(data.roomId).emit('player:status', {
      userId,
      ready: true,
    });

    // Check if both players ready → start game
    const room = await this.roomsService.getRoom(data.roomId, userId);
    const allReady =
      room.players.length === 2 && room.players.every((p) => p.ready);

    if (allReady && room.status === 'WAITING') {
      const state = await this.engineService.startGame(data.roomId);
      this.server.to(data.roomId).emit('game:start', { roomId: data.roomId });
      this.server.to(data.roomId).emit('game:state', state);

      // Schedule speed-battle timer if applicable
      if (state.gameType === 'SPEED_BATTLE' && (state as any).questionDeadline) {
        this.scheduleSpeedBattleTimeout(data.roomId, (state as any).questionDeadline);
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
    const userId = client.data.userId;
    if (!userId) {
      client.emit('game:reject', { reason: 'Not authenticated' });
      return;
    }

    const outcome = await this.engineService.handleAction(
      data.roomId,
      userId,
      { action: data.action, payload: data.payload },
    );

    if (!outcome.changed) {
      client.emit('game:reject', { reason: 'Move rejected' });
      return;
    }

    // Broadcast updated state to all
    this.server.to(data.roomId).emit('game:state', outcome.state);

    if (outcome.roundEnded) {
      this.server.to(data.roomId).emit('game:round_end', {
        roomId: data.roomId,
        roundNumber: outcome.state.roundNumber - (outcome.finished ? 0 : 1),
        winnerId: outcome.roundWinnerId,
      });
    }

    if (outcome.finished) {
      this.server.to(data.roomId).emit('game:finished', {
        roomId: data.roomId,
        results: outcome.results,
      });
    }

    // Schedule next speed-battle timer if applicable
    if (
      !outcome.finished &&
      outcome.state.gameType === 'SPEED_BATTLE' &&
      (outcome.state as any).questionDeadline
    ) {
      this.scheduleSpeedBattleTimeout(data.roomId, (outcome.state as any).questionDeadline);
    }
  }

  @SubscribeMessage('game:sync')
  async handleSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const state = await this.engineService.getCurrentState(data.roomId);
    if (state) {
      client.emit('game:state', state);
    }
  }

  @SubscribeMessage('game:timeout')
  async handleTimeout(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    const outcome = await this.engineService.handleTimeout(data.roomId);
    if (!outcome.changed) return;

    this.server.to(data.roomId).emit('game:state', outcome.state);

    if (outcome.roundEnded) {
      this.server.to(data.roomId).emit('game:round_end', {
        roomId: data.roomId,
        roundNumber: outcome.state.roundNumber - (outcome.finished ? 0 : 1),
        winnerId: outcome.roundWinnerId,
      });
    }

    if (outcome.finished) {
      this.server.to(data.roomId).emit('game:finished', {
        roomId: data.roomId,
        results: outcome.results,
      });
    }

    // Schedule next speed-battle timer
    if (
      !outcome.finished &&
      outcome.state.gameType === 'SPEED_BATTLE' &&
      (outcome.state as any).questionDeadline
    ) {
      this.scheduleSpeedBattleTimeout(data.roomId, (outcome.state as any).questionDeadline);
    }
  }

  /* ── Reactions ───────────────────────────────────────────────── */

  @SubscribeMessage('player:reaction')
  handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; reaction: string },
  ) {
    client
      .to(data.roomId)
      .emit('player:reaction', {
        userId: client.data.userId,
        reaction: data.reaction,
      });
  }

  /* ── Couple unlink (realtime notify partner) ─────────────────── */

  @SubscribeMessage('couples:unlink')
  async handleUnlink(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;

    // Broadcast to all authenticated sockets; frontend filters by couple
    this.server.emit('couple:unlinked', { byUserId: userId });
  }

  /* ── Couple linked (realtime notify partner) ─────────────────── */

  @SubscribeMessage('couples:joined')
  async handleJoined(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { couple: any },
  ) {
    // Broadcast the new couple state to all sockets — partner's app updates instantly
    this.server.emit('couple:linked', data.couple);
  }

  /* ── Instant room destruction ─────────────────────────────────── */

  private async destroyRoom(roomId: string, userId?: string) {
    // Mark room finished
    try {
      await this.roomsService.setRoomStatus(roomId, 'FINISHED');
    } catch {}

    // Drop engine state
    this.engineService.dropLive(roomId);

    this.server.to(roomId).emit('game:abandoned', {
      roomId,
      reason: 'Partner disconnected',
    });
  }

  /* ── Speed Battle timer ──────────────────────────────────────── */

  private speedTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private scheduleSpeedBattleTimeout(roomId: string, deadline: number) {
    // Clear existing
    const existing = this.speedTimers.get(roomId);
    if (existing) clearTimeout(existing);

    const delay = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => {
      this.handleTimeout(
        { data: {} } as any,  // dummy client — timeout is server-initiated
        { roomId },
      );
    }, Math.min(delay, 16_000));

    this.speedTimers.set(roomId, timer);
  }
}
