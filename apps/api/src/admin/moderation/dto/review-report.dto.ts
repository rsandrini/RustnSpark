import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const REVIEW_ACTIONS = ['DISMISS', 'RESET_SHIP_NAME', 'RESET_PILOT_NAME', 'BAN'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

const NOTE_MAX = 300;

export class ReviewReportDto {
  @IsIn([...REVIEW_ACTIONS])
  action!: ReviewAction;

  // The reviewer's note; it goes on the report and into the audit row.
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}
