import { IsBoolean, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SetFlagDto {
  @IsBoolean()
  value!: boolean;
}

// Bilingual broadcast copy, same LocalizedText shape as faction/mission display text.
export class LocalizedMessageDto {
  @IsString()
  @IsNotEmpty()
  en!: string;

  @IsString()
  @IsNotEmpty()
  'pt-BR'!: string;
}

export class CreateNoticeDto {
  @ValidateNested()
  @Type(() => LocalizedMessageDto)
  message!: LocalizedMessageDto;
}
