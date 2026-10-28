export const MAX_GAME_ROUNDS = 15;

export const PLAYER_REACTIONS = ['❤️', '😂', '😭', '😈', '🔥'] as const;

export type PlayerReaction = (typeof PLAYER_REACTIONS)[number];
