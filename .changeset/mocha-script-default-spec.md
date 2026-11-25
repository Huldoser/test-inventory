---
'test-inventory': patch
---

Respect a root Mocha script's file selection during discovery. A script that names its specs no longer picks up unrelated files directly under `test/` through Mocha's default spec.

Combine Mocha's configured specs, extensions, ignores and preloads with the command line, honor `--no-recursive`, and prefer existing literal spec paths to glob expansion. During discovery, apply simple package-script file filters from Jest, Vitest and Playwright, including Playwright commands in packages without a config.

Follow literal working-directory changes before runner commands and include Playwright project prerequisites and teardown when filtering files. Match Mocha's ignore paths, config aliases, comma-separated settings, preload resolution and extensionless spec lookup.

Match Mocha's glob character classes and extension-list spacing. Omit Playwright setup and teardown selected only by empty or hook-only specs.

Honor shell `true` and `false` in conditional directory changes. Apply Playwright project title filters before selecting setup, recognize imports that only export data, and match Mocha ignore character classes and extended patterns.

Collect tests registered by a helper called directly on a CommonJS import, such as `require('./checks').validateOrder()`.

Follow Playwright tests registered when local modules load. Honor Playwright's file filtering when tests originate in a helper with a different extension, including matching enclosing describes.

Honor TypeScript import removal when collecting Playwright registrations, including imports used only in type annotations and imports retained for JSX.

Assign a shared Playwright module's top-level tests to the first spec that loads it in each command, including when deciding whether a setup project runs.
