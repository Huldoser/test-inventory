---
'test-inventory': patch
---

Read a test or describe whose function a wrapper call receives, as in `test('fills an order', withBroker(async () => {}))`: the tests inside such a describe were missing without a diagnostic, and such a test had a null `bodyHash`, so a diff missed edits to it, and an `expectCount` of 0. The function's parameters are the wrapper's, so they are not read as fixtures.
