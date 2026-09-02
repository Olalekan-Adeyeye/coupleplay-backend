import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { CouplesService } from './couples.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('couples')
@UseGuards(JwtAuthGuard)
export class CouplesController {
  constructor(private couplesService: CouplesService) {}

  @Get('me')
  getMyCouple(@Req() req: any) {
    return this.couplesService.getMyCouple(req.user.id);
  }

  @Post('invite')
  generateInvite(@Req() req: any) {
    return this.couplesService.generateInviteCode(req.user.id);
  }

  @Post('join/:code')
  joinByCode(@Req() req: any, @Param('code') code: string) {
    return this.couplesService.joinByInviteCode(req.user.id, code);
  }
}
