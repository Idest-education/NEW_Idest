import { IsEmail } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;
}
