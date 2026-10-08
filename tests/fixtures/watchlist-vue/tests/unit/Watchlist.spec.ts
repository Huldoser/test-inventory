import { mount } from '@vue/test-utils';
import Watchlist from '../../src/components/Watchlist.vue';

const quotes = [
  { symbol: 'AAPL', last: 187.5, changePercent: 1.2 },
  { symbol: 'MSFT', last: 420.1, changePercent: -0.4 },
  { symbol: 'NVDA', last: 118.3, changePercent: 3.8 },
];

describe('Watchlist', () => {
  it('lists one row per symbol', () => {
    const wrapper = mount(Watchlist, { props: { quotes } });
    expect(wrapper.findAll('[data-test="watchlist-row"]')).toHaveLength(3);
  });

  it('sorts by change when the Change header is clicked', async () => {
    const wrapper = mount(Watchlist, { props: { quotes } });
    await wrapper.get('[data-test="sort-by-change"]').trigger('click');
    const symbols = wrapper.findAll('[data-test="watchlist-row"] td:first-child').map((cell) => cell.text());
    expect(symbols).toEqual(['NVDA', 'AAPL', 'MSFT']);
  });

  it('emits remove with the symbol of the row', async () => {
    const wrapper = mount(Watchlist, { props: { quotes } });
    await wrapper.findAll('button').at(-1)?.trigger('click');
    expect(wrapper.emitted('remove')).toEqual([['NVDA']]);
  });

  describe('when the feed is delayed', () => {
    it('shows how many minutes the quotes are delayed', () => {
      const wrapper = mount(Watchlist, { props: { quotes, delayedMinutes: 15 } });
      expect(wrapper.get('[data-test="delay-banner"]').text()).toBe('Quotes are delayed by 15 minutes');
    });

    it.todo('greys out quotes older than the delay');
  });
});
