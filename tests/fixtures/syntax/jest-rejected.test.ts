// Forms for which Jest fails the whole settlement-service file, so that none of its tests run. Not meant to run.
import { describe, test } from '@jest/globals';

describe('settlement calendar', () => {
  test('skips weekends', () => {});
  test.only.concurrent('skips exchange holidays', async () => {});
  test.todo('skips half days', () => {});
  test('reads the holiday calendar');
});

describe('cut-off times', async () => {
  test('uses the custodian cut-off', () => {});
});
