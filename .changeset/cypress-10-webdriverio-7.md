---
'test-inventory': minor
---

Support Cypress 10.0 and newer, from 12.0, and WebdriverIO 7.0 and newer, from 8.0: comparing the fixtures with Cypress 10.11.0 and 11.2.0 and WebdriverIO 7.40.0 running them found no difference, and their test syntax is the same. Cypress before 10 kept its config in `cypress.json`, which the scan doesn't read.
