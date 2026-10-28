import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  avatar?: string;
}
