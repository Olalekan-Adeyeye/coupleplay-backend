import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private userSockets = new Map<string, Set<string>>();

  constructor(private roomsService: RoomsService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const rooms = Array.from(client.rooms);
    for (const roomId of rooms) {
      this.server.to(roomId).emit('player:presence', {
        socketId: client.id,
        connected: false,
      });
    }
  }

  @SubscribeMessage('authenticate')
  handleAuth(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    client.data.userId = data.userId;

    if (!this.userSockets.has(data.userId)) {
      this.userSockets.set(data.userId, new Set());
    }
    this.userSockets.get(data.userId)!.add(client.id);

    client.emit('authenticated', { userId: data.userId });
  }

  @SubscribeMessage('room:create')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { coupleId: string; gameType: string; totalRounds?: number },
  ) {
    const room = await this.roomsService.createRoom(
      data.coupleId,
      data.gameType as any,
      data.totalRounds ?? 5,
    );
    client.join(room.id);
    client.emit('room:created', room);
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

    this.server.to(data.roomId).emit('room:player_joined', {
      roomId: data.roomId,
      userId,
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
    client.leave(data.roomId);
    this.server.to(data.roomId).emit('room:player_left', {
      roomId: data.roomId,
      userId: client.data.userId,
    });
  }

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
  }

  @SubscribeMessage('game:action')
  handleGameAction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; action: string; payload?: any },
  ) {
    this.server.to(data.roomId).emit('game:action', {
      userId: client.data.userId,
      action: data.action,
      payload: data.payload,
    });
  }

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
}
