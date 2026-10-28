import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsGameType } from '../../common/validators/is-game-type.validator';
import { MAX_GAME_ROUNDS } from '../../common/constants';

export class CreateRoomDto {
  @IsUUID()
  coupleId!: string;

  @IsGameType()
  gameType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GAME_ROUNDS)
  totalRounds?: number;
}
