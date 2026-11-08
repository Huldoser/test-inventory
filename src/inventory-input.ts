import schema from '../schema/v1.json' with { type: 'json' };
import { OptionsError } from './options.ts';
import type { Inventory } from './types.ts';

interface Schema {
  $ref?: string;
  anyOf?: Schema[];
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  pattern?: string;
  items?: Schema;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
}

const definitions = schema.definitions as Record<string, Schema>;

/** Checks the published inventory format without running code from the saved file. */
function matches(value: unknown, rule: Schema): boolean {
  if (rule.$ref) return matches(value, definitions[rule.$ref.slice('#/definitions/'.length)]);
  if (Array.isArray(rule.type)) return rule.type.some((type) => matches(value, { ...rule, type }));
  if (rule.anyOf) return rule.anyOf.some((option) => matches(value, option));
  if ('const' in rule && value !== rule.const) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === 'null') return value === null;
  if (rule.type === 'string')
    return typeof value === 'string' && (!rule.pattern || new RegExp(rule.pattern).test(value));
  if (rule.type === 'boolean') return typeof value === 'boolean';
  if (rule.type === 'number' || rule.type === 'integer') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (rule.type !== 'integer' || Number.isInteger(value)) &&
      (rule.minimum === undefined || value >= rule.minimum)
    );
  }
  if (rule.type === 'array') return Array.isArray(value) && value.every((item) => matches(item, rule.items as Schema));
  {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (rule.required?.some((key) => !Object.hasOwn(object, key))) return false;
    return Object.entries(object).every(([key, item]) => {
      const property = rule.properties && Object.hasOwn(rule.properties, key) ? rule.properties[key] : undefined;
      if (property) return matches(item, property);
      return typeof rule.additionalProperties === 'object'
        ? matches(item, rule.additionalProperties)
        : rule.additionalProperties !== false;
    });
  }
}

/** Validates a saved scan before a diff reads its records; projected records and JSON Lines are not full scans. */
export function checkInventory(value: unknown, name: string): asserts value is Inventory {
  let valid = false;
  try {
    JSON.stringify(value);
    valid = matches(value, schema);
  } catch {
    // Cyclic objects and excessively deep metadata are not saved inventories.
  }
  if (!valid)
    throw new OptionsError(`${name} must be a complete schema v1 JSON inventory, without --fields or --format jsonl.`);
  const inventory = value as Inventory;
  const ids = new Set(inventory.tests.map((test) => test.id));
  if (ids.size !== inventory.tests.length)
    throw new OptionsError(`${name} contains duplicate test ids. Scan it again without combining inventories.`);
}
