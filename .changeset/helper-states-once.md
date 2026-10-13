---
'test-inventory': patch
---

A test or hook that calls helper functions which call each other in many places no longer makes the scan hang. Each helper's states are applied once for each set of conditions it is reached under, and past 10,000 helper calls from one call, a `state-in-helper` warning says the rest are not applied.
