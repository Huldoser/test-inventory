---
'test-inventory': patch
---

Apply Jasmine's empty-suite rules by version and allow unused callback arguments on focused and skipped suites.
Recognize suites whose spec declarations cannot run, and account for code evaluated in hook arguments.
Mark specs registered after a nested Jasmine declaration error as not loaded, with their earlier siblings and recovery paths preserved.
Keep Jasmine files runnable when they catch their own registration errors.
Assign recovery specs to the suite Jasmine leaves open after it rejects an empty suite.
Omit Jasmine recovery specs when the guarded registrations and local helpers complete without throwing.
Collect specs declared while evaluating Jasmine runner arguments in call order, stopping at a synchronous exception.
Use supplied helper arguments when deciding which parameter defaults register specs.
Honor synchronous errors from invalid spreads and destructuring in Jasmine declaration arguments.
Read string elements and boxed properties in helper parameters so registration defaults and generated titles match the runner.
Apply argument ordering and parameter binding to direct Jasmine helper calls and immediately invoked functions.
Attach Jasmine declarations and hooks to the suite left open by their arguments.
Preserve the current Jasmine suite across the synchronous part of an async registration helper.
Collect successive statements after a Jasmine helper suspends in microtask order, with their captured parameters.
