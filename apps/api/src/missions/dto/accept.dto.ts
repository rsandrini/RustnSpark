import { IsUUID } from 'class-validator';

export class AcceptMissionDto {
  @IsUUID('4')
  shipId!: string;
}
