// Every Bun form the scanner reads, written as one quote gateway test file, with Bun's globals. Not meant to run.
describe('quote book', () => {
  beforeAll(() => {});
  beforeEach(() => {});
  afterEach(() => {});
  afterAll(() => {});

  test('keeps the best bid', () => {});
  it('keeps the best ask', { timeout: 2_000, retry: 2 }, () => {});
  test('keeps the queue', () => {}, 500);
  test('keeps the depth', () => {}, { repeats: 3 });
  test.skip('streams quotes from the venue', () => {});
  xit('streams depth from the venue', () => {});
  test.todo('drops a stale quote after 500 ms');
  test.todo('expires a quote', () => {});
  test.failing('rejects a crossed book', () => {});
  test.only('quotes the spread', () => {});
  test.concurrent('quotes in parallel', () => {});
  test.serial('quotes in order', () => {});
  test.if(process.env.VENUE_URL)('streams trades', () => {});
  test.skipIf(process.platform === 'win32')('watches the feed', () => {});
  test.todoIf(!process.env.DARK_POOL)('routes to a dark pool', () => {});
  test.failingIf(process.env.CROSSED === '1')('prices a crossed quote', () => {});
  test.skip.each([[1], [2]])('reprices level %i', () => {});
  test.each([
    ['XNAS', 0.5],
    ['XLON', 1.25],
  ])('quotes %s at %d bps', () => {});
  test.each([{ mic: 'ARCX', desk: { name: 'rates' } }])('routes $mic for $desk.name', () => {});

  describe.each([['equities'], ['futures']])('%s desk', () => {
    test('books a trade', () => {});
  });

  describe.skip('dark pool quotes', () => {
    test('hides the size', () => {});
  });

  describe.concurrent('settlement', () => {
    test('settles a trade', () => {});
  });
});
