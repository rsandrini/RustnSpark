import { IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const NOTICE_MAX_LENGTH = 500;

export class SetFlagDto {
  @IsBoolean()
  value!: boolean;
}

// Bilingual broadcast copy, same LocalizedText shape as faction/mission display text.
export class LocalizedMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTICE_MAX_LENGTH)
  en!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTICE_MAX_LENGTH)
  'pt-BR'!: string;
}

export class CreateNoticeDto {
  @ValidateNested()
  @Type(() => LocalizedMessageDto)
  message!: LocalizedMessageDto;
}
