import { Controller, Get, Delete, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  deleteAccount(@Req() req: any) {
    return this.usersService.deleteAccount(req.user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@Req() req: any, @Body() body: { avatar?: string }) {
    return this.usersService.updateMe(req.user.id, body);
  }
}
