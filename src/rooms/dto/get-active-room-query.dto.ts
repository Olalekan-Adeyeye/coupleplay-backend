import { IsOptional } from 'class-validator';
import { IsGameType } from '../../common/validators/is-game-type.validator';

export class GetActiveRoomQueryDto {
  @IsOptional()
  @IsGameType()
  gameType?: string;
}
