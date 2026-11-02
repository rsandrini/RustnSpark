import { IsString, MaxLength } from 'class-validator';

// Generous bound on what is read; the real limit (SHIP_NAME_MAX) is the service's.
const MAX_READ_LENGTH = 60;

export class RenameShipDto {
  // The pilot's part of the name (after the fixed faction prefix). Length and characters are checked by the
  // service, which answers with a coded error; this only bounds what is read.
  @IsString()
  @MaxLength(MAX_READ_LENGTH)
  name!: string;
}
