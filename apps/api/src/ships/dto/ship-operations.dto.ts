import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsUUID, ValidateNested } from 'class-validator';

const RIGHT_ANGLE = 90;

export class PlacementDto {
  @IsUUID('4')
  partInstanceId!: string;

  @IsInt()
  gx!: number;

  @IsInt()
  gy!: number;

  @IsIn([0, RIGHT_ANGLE])
  rot!: number;
}

export class AssembleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlacementDto)
  layout!: PlacementDto[];
}

export class AutoAssembleDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  partInstanceIds?: string[];
}

export class PreviewDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlacementDto)
  layout?: PlacementDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  partInstanceIds?: string[];
}

export class StanceDto {
  @IsIn(['DEFENSIVE', 'NEUTRAL', 'AGGRESSIVE'])
  stance!: 'DEFENSIVE' | 'NEUTRAL' | 'AGGRESSIVE';
}
