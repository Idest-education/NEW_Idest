import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Deleting an account is irreversible on Clerk's side, so the caller has to
 * retype their own email. A stray DELETE cannot take a teacher's board down.
 */
export class DeleteAccountDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(320)
  confirmEmail!: string;
}
