import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const LOCATION_ID_MAX = 64;

export class TravelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOCATION_ID_MAX)
  destinationId!: string;
}

export class TravelQuoteQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOCATION_ID_MAX)
  destinationId!: string;
}
