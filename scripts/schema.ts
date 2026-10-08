import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

const root = path.resolve(import.meta.dirname, '..');

export const schemaPath = path.join(root, 'schema', 'v1.json');

/** Sets that later releases may add values to; a reader of v1 must accept a value it doesn't know yet. */
const OPEN_SETS = ['Framework', 'TestState', 'StateSource', 'DiagnosticCode'];

export function generateSchema(): string {
  const schema = createGenerator({
    path: path.join(root, 'src', 'types.ts'),
    tsconfig: path.join(root, 'tsconfig.json'),
    type: 'Inventory',
    schemaId: 'https://huldoser.github.io/test-inventory/schema/v1.json',
    sortProps: false,
    // Readers must ignore keys they don't know, so output that gained a key still validates against v1.
    additionalProperties: true,
  }).createSchema('Inventory');
  const definitions = schema.definitions as Record<string, { type?: string; enum?: string[]; description?: string }>;
  for (const name of OPEN_SETS) {
    const { description, ...known } = definitions[name];
    definitions[name] = {
      ...(description && { description: `${description} Other values may be added in later releases.` }),
      anyOf: [known, { type: 'string' }],
    } as never;
  }
  return `${JSON.stringify(schema, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(schemaPath, generateSchema());
}
