import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class DispatchMissionDto {
  @IsUUID('4')
  missionId!: string;

  /** RACE only: push the engines for speed (burns more fuel, may overheat). */
  @IsOptional()
  @IsBoolean()
  overdrive?: boolean;
}
