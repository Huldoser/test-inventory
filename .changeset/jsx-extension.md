---
'test-inventory': patch
---

An import written with a `.jsx` extension now finds the `.tsx` file it refers to, as `.js` already found `.ts`, so
`import { OrderHeader } from './OrderHeader.jsx'` is followed instead of marking the test with
`hasUnfollowedDependencies`.
