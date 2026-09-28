import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject } from 'class-validator';

export class SaveFeedbackDto {
  @ApiProperty({ example: 1, description: 'INSTRUMENT_VERSION the form was rendered from' })
  @IsInt()
  instrumentVersion!: number;

  /** Checked item by item against @repo/feedback-contract in the service. */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { ux1: 4, ux2: 5, nps: 9 },
    description: 'Answers keyed by SPSS variable code',
  })
  @IsObject()
  answers!: Record<string, unknown>;
}
