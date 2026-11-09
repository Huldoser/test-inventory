import { filterInventory, pickTestFields, scan } from 'test-inventory';

const inventory = await scan({
  root: process.argv[2] ?? '.',
  framework: 'playwright',
  patterns: ['tests/**/*.spec.ts'],
});
const marked = filterInventory(inventory, { states: ['skip', 'fixme', 'todo'] });
const answer = pickTestFields(marked, ['fullName', 'state', 'condition', 'reason']);
console.log(JSON.stringify(answer, null, 2));

if (inventory.diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
  process.stderr.write('The scan has errors; tests may be missing. Inspect diagnostics before using the report.\n');
  process.exitCode = 2;
}
