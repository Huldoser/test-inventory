---
'test-inventory': patch
---

A call through a Vitest member that reads the function it is called on, destructured as in
`const { each } = test; each([1, 2])('sizes lot %i', fn)`, is now an `invalid-chain` error, and the file's tests are
`notLoaded`: Vitest fails the file. That holds for `each`, `for`, `skipIf` and `runIf` of `test` and `each` of
`describe` in every version, `extend`, `scoped` and `override` from Vitest 4.1, and `for` of `describe` from Vitest 5.
Before, the scan said nothing and listed the file's other tests as active.
