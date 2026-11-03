import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Far above any admin limit: the real one (mining.job_max_ticks) is the service's, which answers
// with a coded error.
const MAX_READ_TICKS = 1000;

export class StartMiningDto {
  // How many ticks to dig (one when left out).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_READ_TICKS)
  ticks?: number;
}
