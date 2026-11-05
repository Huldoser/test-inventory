---
'test-inventory': minor
---

A new `invalid-fixture-argument` error: a rest property among a Playwright function's fixture arguments, as
`async ({ page, ...fixtures }) => {}` in a test, hook, `test.skip()` condition or `test.extend()` fixture. Playwright
refuses it and runs no tests at all, so the file's tests are now `notLoaded` instead of `active`. A nested rest, as
`({ page: { mouse, ...pointer } })`, and a `test.step()` callback are allowed, as Playwright allows them.
