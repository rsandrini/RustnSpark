import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * S8.3 refuel: `mode: 'full'` fills the tank to `fuelCap`; `mode: 'partial'`
 * buys `amount` units (capped by the remaining tank space). `amount` is
 * required (>0) for `partial` (checked in the service, since class-validator
 * cannot express "required only when mode=partial") and ignored for `full`.
 */
export class RefuelDto {
  @IsIn(['full', 'partial'])
  mode!: 'full' | 'partial';

  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;
}
