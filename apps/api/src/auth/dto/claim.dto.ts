import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

/** A guest saving the pilot: the same email and password rules as registering, and an optional pilot name. */
export class ClaimDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 128)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(3, 24)
  @Matches(/^[A-Za-z0-9_-]+$/)
  name?: string;
}
