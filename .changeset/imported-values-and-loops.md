---
'test-inventory': minor
---

Values imported from other files of the project are now worked out: a title, tag, annotation, reason, run setting or
`.each` table built from a constant, enum or default export of another module, through re-exports, `export *`,
`import * as` and JSON files, found the same way as helper functions (relative paths, tsconfig `paths`, `#imports`,
workspace packages). Values from installed packages are still not read, and keep their diagnostic.

A test in a `for...of`, `for...in`, `forEach` or `map` loop over values the scan can work out now has `caseCount`, the
number of tests the runner registers, and no `test-in-loop` warning; the warning now marks a loop the scan can't
count. Values also work out arithmetic on numbers, as in `30 * 1000`, `?:`, `&&`, `||`, `??`, comparisons,
`Object.keys()`, `Object.values()`, `Object.entries()`, `JSON.stringify()`, `String()`, and a string's `toUpperCase()`,
`toLowerCase()` and `trim()` and an array's `join()`. A skip condition that works out to a constant, such as
`side === 'short'` in a helper called with `'buy'`, now sets the state it gives instead of being kept as a condition.

Code after an `if` whose branch returns or throws, as in `if (!strategy.enabled) return;` in a helper, is now under
the opposite condition, so its tests have `isInCondition` and a loop around them no count. A tagged-template table is
counted as Vitest splits it: outer pipes are columns, an incomplete last row is left out, and a template without
values is one case.

A test whose title was its source text and is now worked out gets a new `id`, once.
