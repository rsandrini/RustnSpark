import { IsIn, IsOptional } from 'class-validator';

export class ScavengeJobDto {
  @IsOptional()
  @IsIn(['ship', 'foot'])
  mode?: 'ship' | 'foot';
}
