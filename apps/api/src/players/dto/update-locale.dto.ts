import { IsIn } from 'class-validator';
import { SUPPORTED_LOCALES, type Locale } from '../../common/locale/locale.js';

export class UpdateLocaleDto {
  @IsIn([...SUPPORTED_LOCALES])
  locale!: Locale;
}
