import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class DialogueEventDto {
  @IsIn(['advance', 'skip', 'done'])
  event!: 'advance' | 'skip' | 'done';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nodeId?: string;
}

export class DialogueSettingsDto {
  @IsBoolean()
  enabled!: boolean;
}
