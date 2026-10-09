import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ROTATIONS } from '../../parts/connectors.js';

// Clockwise quarter turns; an engine/weapon faces W at rot 0 and turns with it.

export class PlacementDto {
  @IsUUID('4')
  partInstanceId!: string;

  @IsInt()
  gx!: number;

  @IsInt()
  gy!: number;

  @IsIn([...ROTATIONS])
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

export class VirtualPartDto {
  @IsString()
  partType!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  condition!: number;
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

  // Market-compare only (round-2 plan §5b item 4): a not-yet-owned catalog part to fold into
  // the sheet computation, standing in for the owned instance a purchase would later create.
  @IsOptional()
  @ValidateNested()
  @Type(() => VirtualPartDto)
  virtualPart?: VirtualPartDto;

  // With `virtualPart`: the currently-installed instance (same class) it would replace. Omitted
  // when nothing of that class is installed yet — the virtual part is then a pure addition.
  @IsOptional()
  @IsUUID('4')
  replacePartInstanceId?: string;
}

export class StanceDto {
  @IsIn(['DEFENSIVE', 'NEUTRAL', 'AGGRESSIVE'])
  stance!: 'DEFENSIVE' | 'NEUTRAL' | 'AGGRESSIVE';
}

export class EnergyModeDto {
  @IsIn(['BATTERY', 'FULL', 'OVERRIDE'])
  energyMode!: 'BATTERY' | 'FULL' | 'OVERRIDE';
}

// Far above any admin range: the real limits come from the engine settings (clampLevels).
const MAX_ENGINE_LEVEL = 10;

export class EngineLevelsDto {
  @IsNumber()
  @Min(0)
  @Max(MAX_ENGINE_LEVEL)
  chem!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_ENGINE_LEVEL)
  ion!: number;
}

export class SetFormatDto {
  @IsString()
  formatId!: string;
}
