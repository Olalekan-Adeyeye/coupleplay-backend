import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;

// Compare target for unknown emails so login timing doesn't leak existence.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  avatar: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username,
          name: dto.name,
          password: hashedPassword,
          ...(dto.avatar && { avatar: dto.avatar }),
        },
        select: { ...PROFILE_SELECT },
      });

      return {
        user,
        token: this.jwtService.sign({ sub: user.id }),
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email or username already taken');
      }
      throw err;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    const valid = await bcrypt.compare(dto.password, user?.password ?? DUMMY_HASH);

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, ...profile } = user;
    const token = this.jwtService.sign({ sub: user.id });

    return {
      user: profile,
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...PROFILE_SELECT, createdAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  async requestPasswordReset() {
    throw new ServiceUnavailableException('Password reset is not available yet. Contact support to recover your account.');
  }
}
