---
'test-inventory': patch
---

Apply Mocha's focus filtering, including Cypress and WebdriverIO on Mocha, so an outer describe.only does not focus
tests that a more specific focus excludes. A root focused test in standalone Mocha excludes child suites across
files. Contain refused calls inside node:test and Bun describe callbacks: Node keeps earlier tests and tests outside
the describe; Bun loses that describe only. Vitest reads allowOnly per project, does not fail unconditionally skipped
focused tests, and refuses modifiers after a called each or for table.
