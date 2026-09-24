import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class RepairTargetDto {
  @IsUUID('4')
  partInstanceId!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  toCondition!: number;
}

export class RepairDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RepairTargetDto)
  targets!: RepairTargetDto[];
}
