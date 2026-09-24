import { IsUUID } from 'class-validator';

export class DispatchMissionDto {
  @IsUUID('4')
  missionId!: string;
}
