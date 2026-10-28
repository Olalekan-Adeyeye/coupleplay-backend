import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsGameType } from '../../common/validators/is-game-type.validator';

export class CreateRoomDto {
  @IsUUID()
  coupleId!: string;

  @IsGameType()
  gameType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  totalRounds?: number;
}
