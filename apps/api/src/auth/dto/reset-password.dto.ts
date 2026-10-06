import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
    @IsString()
    token!: string;

    @IsString()
    @Length(8, 64)
    newPassword!: string;
}
