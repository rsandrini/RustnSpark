import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

export class BuyDto {
  @IsString()
  @IsNotEmpty()
  listingId!: string;

  @IsInt()
  @Min(0)
  expectedPrice!: number;
}

export class SellDto {
  @IsUUID('4')
  partInstanceId!: string;

  @IsInt()
  @Min(0)
  expectedPrice!: number;
}

export class SellMaterialDto {
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @IsInt()
  quantity!: number;

  @IsInt()
  @Min(0)
  expectedPrice!: number;
}
