import { IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Far above any admin range: the real limits come from the engine settings (clampLevels).
const MAX_LEVEL = 10;

export class EnginePreviewDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_LEVEL)
  chem?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_LEVEL)
  ion?: number;

  @IsOptional()
  @IsUUID('4')
  missionId?: string;
}
