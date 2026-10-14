import { IsBoolean, IsOptional } from 'class-validator';

export class DiscardInventoryDto {
  @IsOptional()
  @IsBoolean()
  sellScrap?: boolean;
}
