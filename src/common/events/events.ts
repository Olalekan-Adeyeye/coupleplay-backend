// Socket event contract shared between client and server.

export interface RoomCreatedEvent {
  id: string;
  coupleId: string;
  gameType: string;
  status: string;
  currentRound: number;
  totalRounds: number;
}

export interface PlayerJoinedEvent {
  roomId: string;
  userId: string;
}

export interface PlayerLeftEvent {
  roomId: string;
  userId: string;
}

export interface PlayerStatusEvent {
  userId: string;
  ready: boolean;
}

export interface PlayerPresenceEvent {
  socketId: string;
  userId: string;
  connected: boolean;
}

export interface PlayerReactionEvent {
  userId: string;
  reaction: string;
}

export interface GameRejectEvent {
  reason: string;
}

export interface RoundEndEvent {
  roomId: string;
  roundNumber: number | null;
  winnerId: string | null;
  /** The just-played round state with answer keys revealed. */
  reveal: unknown | null;
}

export interface CoupleEvent {
  coupleId: string;
}

// Server → Client events
export interface ServerToClientEvents {
  authenticated: (data: { ok: boolean; userId?: string; error?: string }) => void;
  'room:created': (room: RoomCreatedEvent) => void;
  'room:ready': (data: { roomId: string; message: string }) => void;
  'room:player_joined': (data: PlayerJoinedEvent) => void;
  'room:player_left': (data: PlayerLeftEvent) => void;
  'player:presence': (data: PlayerPresenceEvent) => void;
  'player:status': (data: PlayerStatusEvent) => void;
  'player:reaction': (data: PlayerReactionEvent) => void;
  'game:reject': (data: GameRejectEvent) => void;
}

// Client → Server events
export interface ClientToServerEvents {
  authenticate: (data: { token: string }) => void;
  'room:create': (data: {
    coupleId: string;
    gameType: string;
    totalRounds?: number;
  }) => void;
  'room:join': (data: { roomId: string }) => void;
  'room:leave': (data: { roomId: string }) => void;
  'player:ready': (data: { roomId: string }) => void;
  'player:reaction': (data: { roomId: string; reaction: string }) => void;
  'game:action': (data: {
    roomId: string;
    action: string;
    payload?: unknown;
  }) => void;
  'couples:joined': () => void;
  'couples:unlink': () => void;
}
