import { ConfigService } from '@nestjs/config';

export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}
