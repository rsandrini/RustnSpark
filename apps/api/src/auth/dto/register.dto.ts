import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { SUPPORTED_LOCALES, type Locale } from '../../common/locale/locale.js';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 128)
  password!: string;

  @IsString()
  @Length(3, 24)
  @Matches(/^[A-Za-z0-9_-]+$/)
  name!: string;

  // Optional: when absent, the controller resolves Accept-Language with a fallback to 'en'.
  @IsOptional()
  @IsIn([...SUPPORTED_LOCALES])
  locale?: Locale;
}
