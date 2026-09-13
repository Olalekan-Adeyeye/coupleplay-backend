import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username!: string;

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
  avatar?: string;
}
