import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { SUPPORTED_LOCALES, type Locale } from '../../common/locale/locale.js';

export class StartGuestDto {
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;
}

export class ResumeGuestDto {
  @IsString()
  @Length(20, 128)
  guestKey!: string;
}
