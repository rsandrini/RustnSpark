import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

// Every support action requires a human reason (S11.4): it lands in the audit row
// alongside before/after, so a later reader knows why the state was forced.
export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CreditsActionDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
