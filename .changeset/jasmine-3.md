---
'test-inventory': minor
---

Support Jasmine 3.0 and newer, from 4.0: Jasmine 3 still has about a million weekly downloads of jasmine-core, and projects on it got an `unsupported-framework-version` warning. Read from jasmine-core 3.99.1 and 4.0.0, `it`, `fit`, `xit` and `describe` check their functions the same way, and comparing the risk fixture with Jasmine 3.99.0 running it found no difference. Jasmine 3's reports give no spec file, so the comparison runs each spec file on its own.
