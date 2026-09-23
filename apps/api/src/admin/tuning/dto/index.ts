import { Allow, IsArray, IsNumber, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export interface ConfigEntryResponse {
  key: string;
  group: string;
  type: string;
  min: number;
  max: number;
  unit?: string;
  description: { en: string; 'pt-BR': string };
  currentValue: unknown;
  factoryDefault: unknown;
  modified: boolean;
}

export class BundleEntryDto {
  @IsString()
  key!: string;

  @Allow()
  value!: unknown;
}

export class UpdateConfigValueDto {
  @Allow()
  value!: unknown;

  @IsNumber()
  expectedRevision!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class ResetConfigValueDto {
  @IsNumber()
  expectedRevision!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class RevertRevisionDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class ImportBundleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BundleEntryDto)
  entries!: BundleEntryDto[];
}
