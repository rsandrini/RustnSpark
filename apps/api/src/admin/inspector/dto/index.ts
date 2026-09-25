import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export const REASON_MAX_LENGTH = 500;
// Far above any legitimate grant, far below Int4 overflow of the wallet column.
export const MAX_CREDITS_ACTION = 1_000_000_000;

// Every support action requires a human reason (S11.4): it lands in the audit row
// alongside before/after, so a later reader knows why the state was forced.
export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(REASON_MAX_LENGTH)
  reason!: string;
}

export class CreditsActionDto {
  @IsInt()
  @Min(1)
  @Max(MAX_CREDITS_ACTION)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(REASON_MAX_LENGTH)
  reason!: string;
}
