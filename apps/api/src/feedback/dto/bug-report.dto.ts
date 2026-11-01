import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class BugReportDto {
  // What the tester wrote. Plain text only: the service escapes it before it goes into the email.
  @IsString()
  @Length(10, 2000)
  message!: string;

  // Where in the app the tester was (a route such as /port), sent by the client for context.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  page?: string;

  // The tester's UI language, for context only.
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
