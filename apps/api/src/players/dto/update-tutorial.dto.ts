import { IsBoolean } from 'class-validator';

export class UpdateTutorialDto {
  @IsBoolean()
  done!: boolean;
}
