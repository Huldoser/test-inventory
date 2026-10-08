import { mount } from '@vue/test-utils';
import WatchlistRow from '../../src/components/WatchlistRow.vue';

function mountRow(changePercent: number) {
  return mount(WatchlistRow, {
    props: { quote: { symbol: 'AAPL', last: 187.5, changePercent } },
    attachTo: document.createElement('tbody'),
  });
}

describe('WatchlistRow', () => {
  it.each([
    [1.2, '+1.20%', 'up'],
    [-0.4, '-0.40%', 'down'],
    [0, '0.00%', 'up'],
  ])('shows a change of %d as %s, pointing %s', (changePercent, text, direction) => {
    const row = mountRow(changePercent);
    expect(row.text()).toContain(text);
    expect(row.attributes('data-direction')).toBe(direction);
  });

  it('emits remove when Remove is clicked', async () => {
    const row = mountRow(1.2);
    await row.get('button').trigger('click');
    expect(row.emitted('remove')).toEqual([['AAPL']]);
  });
});
