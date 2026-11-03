import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export const REPORT_SUBJECTS = ['SHIP_NAME', 'PILOT_NAME'] as const;
export const REPORT_REASONS = ['OFFENSIVE', 'IMPERSONATION', 'OTHER'] as const;
export type ReportSubject = (typeof REPORT_SUBJECTS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

// Same bounds as a pilot name at registration.
const PILOT_NAME_MIN = 3;
const PILOT_NAME_MAX = 24;
const NOTE_MAX = 300;

export class NameReportDto {
  // The pilot being reported, by name (what the reporter sees on the pilot card).
  @IsString()
  @Length(PILOT_NAME_MIN, PILOT_NAME_MAX)
  playerName!: string;

  @IsIn([...REPORT_SUBJECTS])
  subject!: ReportSubject;

  @IsIn([...REPORT_REASONS])
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}
