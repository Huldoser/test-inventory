---
'test-inventory': minor
---

`scan()` takes a `signal`, an `AbortSignal`: the scan checks it before it starts and between files, and rejects with
the signal's `reason` once it aborts, so a server can stop a scan its client no longer waits for.
