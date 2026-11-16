---
'test-inventory': minor
---

Support Jest 27.0 and newer, from 29.0: about a third of the popular projects that use Jest are on 26 to 28, which the scan read with a warning that the version wasn't supported. Read from `jest-circus` 27.5 and 28.0, the chains are those of Jest 29 but for `.failing`, which is an `invalid-chain` error before Jest 28, as the call throws and Jest fails the file. Checked against Jest 27.5.1 and 28.1.3 running the settlement fixture, with `.each` case titles.
