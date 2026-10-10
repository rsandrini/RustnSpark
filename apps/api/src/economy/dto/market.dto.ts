import { IsInt, IsNotEmpty, IsString, IsUUID, Max, Min } from 'class-validator';

// PlayerMaterial.quantity is an int4 column and the sale is a raw `quantity - $1`
// UPDATE: a quantity past the column's ceiling fails inside Postgres (integer out of
// range) and surfaces as a 500 instead of the domain 400. Cap at the column's own
// maximum; the price-side overflow (unitPrice × quantity past MAX_CREDITS) is guarded
// in MaterialsService.sell.
export const MAX_SELL_QUANTITY = 2_147_483_647;

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
  @Min(1)
  @Max(MAX_SELL_QUANTITY)
  quantity!: number;

  @IsInt()
  @Min(0)
  expectedPrice!: number;
}

export class CraftCoreDto {
  @IsString()
  @IsNotEmpty()
  core!: string;
}
