import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOnboardingDto } from './update-onboarding.dto.js';

const errorsFor = (body: object) => validate(plainToInstance(UpdateOnboardingDto, body));

describe('UpdateOnboardingDto', () => {
  it('accepts true and false', async () => {
    expect(await errorsFor({ dismissed: true })).toHaveLength(0);
    expect(await errorsFor({ dismissed: false })).toHaveLength(0);
  });

  it('rejects a missing flag', async () => {
    expect(await errorsFor({})).not.toHaveLength(0);
  });

  it('rejects string, number and null look-alikes', async () => {
    for (const dismissed of ['true', 'false', 1, 0, null]) {
      expect(await errorsFor({ dismissed })).not.toHaveLength(0);
    }
  });
});
