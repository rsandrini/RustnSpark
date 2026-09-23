import { IsIn } from 'class-validator';

const PLAYABLE_FACTIONS = ['luna', 'sun', 'explorers'] as const;
export type PlayableFaction = (typeof PLAYABLE_FACTIONS)[number];

export class OnboardingDto {
  @IsIn(PLAYABLE_FACTIONS)
  faction!: PlayableFaction;
}
