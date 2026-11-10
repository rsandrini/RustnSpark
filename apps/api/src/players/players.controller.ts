import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { UpdateLocaleDto } from './dto/update-locale.dto.js';
import { UpdateTutorialDto } from './dto/update-tutorial.dto.js';
import { OnboardingDto } from './dto/onboarding.dto.js';
import { PrologueOutcomeDto } from './dto/prologue-outcome.dto.js';
import { OnboardingService } from './onboarding.service.js';
import { PlayersService, type PlayerProfile, type TutorialProgress } from './players.service.js';

// No @Public() anywhere here: the global JwtAuthGuard's default-deny applies (R28), and the
// player is identified by the token claims rather than a path param (no OwnershipGuard needed).
@Controller('players')
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly onboardingService: OnboardingService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: CurrentUserPayload): Promise<PlayerProfile> {
    return this.playersService.getProfile(user.playerId);
  }

  @Get('me/tutorial-progress')
  getTutorialProgress(@CurrentUser() user: CurrentUserPayload): Promise<TutorialProgress> {
    return this.playersService.getTutorialProgress(user.playerId);
  }

  @Post('me/locale')
  @HttpCode(200)
  updateLocale(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateLocaleDto,
  ): Promise<PlayerProfile> {
    return this.playersService.updateLocale(user.playerId, dto.locale);
  }

  @Post('me/tutorial')
  @HttpCode(200)
  updateTutorial(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateTutorialDto,
  ): Promise<PlayerProfile> {
    return this.playersService.updateTutorial(user.playerId, dto.done);
  }

  @Get('me/prologue')
  getPrologue() {
    return this.onboardingService.prologue();
  }

  @Post('me/prologue')
  @HttpCode(200)
  async savePrologue(@CurrentUser() user: CurrentUserPayload, @Body() dto: PrologueOutcomeDto) {
    return {
      outcome: await this.onboardingService.savePrologueOutcome(user.playerId, dto.outcome),
    };
  }

  @Post('me/onboarding')
  @HttpCode(200)
  onboard(@CurrentUser() user: CurrentUserPayload, @Body() dto: OnboardingDto) {
    return this.onboardingService.onboard(user.playerId, dto.faction);
  }
}
