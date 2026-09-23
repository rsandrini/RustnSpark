import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The playable factions are the keys of the Admin-editable `onboarding.home_locations`, so the
// service validates the value against live config rather than a hard-coded list here.
export class OnboardingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  faction!: string;
}
