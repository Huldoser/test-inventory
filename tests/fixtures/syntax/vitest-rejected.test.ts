// Forms for which Vitest fails while it loads the file, from the version that removed them, so every test in it is
// `notLoaded` there: options as the third argument from Vitest 4, `sequential` and `bench` from Vitest 5. Not meant
// to run.
import { bench, describe, it, test } from 'vitest';

describe.concurrent('position sizing', () => {
  it('risks 1% of the account', () => {});
  it.sequential('caps the size at the cash available', () => {});
});

describe.sequential('stop orders', () => {
  it('triggers below the stop price', () => {});
});

describe('fees', () => {
  test('charges the minimum commission', () => {}, { retry: 2 });
});

describe('benchmarks', () => {
  bench('sma over ten years of closes', () => {});
});
