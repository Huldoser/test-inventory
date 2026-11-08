import { expect, it } from 'vitest';
import { compareWithVitest, type ListedModule } from '../scripts/compare-vitest-list.ts';
import { scanSource } from '../src/index.ts';
import { project } from './project.ts';

function example() {
  const code = `import { describe, test } from 'vitest';
function ordersBlock() {
  test('quotes the bid', () => {});
}
ordersBlock();
describe('paper', ordersBlock);
describe('live', ordersBlock);
describe('inline', () => {
  test('quotes the ask', () => {});
});`;
  const file = 'orders.test.ts';
  const root = project({ [file]: code });
  const inventory = scanSource({ code, relativeFilePath: file, framework: 'vitest' });
  const modules: ListedModule[] = [
    {
      file,
      errors: [],
      tests: [
        { name: 'quotes the bid', line: 3, column: 3, mode: 'run' },
        { name: 'inline > quotes the ask', line: 9, column: 3, mode: 'run' },
      ],
    },
  ];
  const paper = inventory.tests.find(({ fullName }) => fullName === 'paper > quotes the bid');
  const inline = inventory.tests.find(({ fullName }) => fullName === 'inline > quotes the ask');
  if (!paper || !inline) throw new Error('The comparison fixture must include both suite contexts');
  return { root, inventory, modules, paper, inline };
}

it('explains the lexical names and single listing of a reused named describe callback', () => {
  const { root, inventory, modules } = example();
  const differences = compareWithVitest(root, inventory, modules);
  expect(differences).toHaveLength(3);
  expect(differences.filter(({ cause }) => cause === null)).toEqual([]);
});

it('keeps an incorrect test title in a named callback unexplained', () => {
  const { root, inventory, modules, paper } = example();
  paper.title = 'quotes the wrong bid';
  paper.fullName = 'paper > quotes the wrong bid';
  expect(compareWithVitest(root, inventory, modules).filter(({ cause }) => cause === null)).toEqual([
    expect.objectContaining({ detail: 'paper > quotes the wrong bid / quotes the bid' }),
  ]);
});

it('keeps an incorrect state in a named callback unexplained', () => {
  const { root, inventory, modules, paper } = example();
  paper.isActive = false;
  paper.state = 'skip';
  expect(compareWithVitest(root, inventory, modules).filter(({ cause }) => cause === null)).toEqual([
    expect.objectContaining({ detail: 'paper > quotes the bid: skip / run' }),
  ]);
});

it('keeps duplicated inline tests unexplained', () => {
  const { root, inventory, modules, inline } = example();
  inventory.tests.push({ ...inline, id: 'EXAMPLE_DUPLICATE' });
  expect(compareWithVitest(root, inventory, modules).filter(({ cause }) => cause === null)).toEqual([
    expect.objectContaining({ detail: "2 records, one in Vitest's list" }),
  ]);
});

it('keeps a duplicated named-callback record in the same suite unexplained', () => {
  const { root, inventory, modules, paper } = example();
  inventory.tests.push({ ...paper, id: 'EXAMPLE_DUPLICATE' });
  expect(compareWithVitest(root, inventory, modules).filter(({ cause }) => cause === null)).toEqual([
    expect.objectContaining({ detail: "4 records, one in Vitest's list" }),
  ]);
});
