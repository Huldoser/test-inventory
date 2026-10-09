---
layout: home

hero:
  name: test-inventory
  text: Test metadata from source code, not from test results.
  tagline: Lists every test declaration in a Playwright or Vitest suite as JSON, by reading the code. Nothing is run.
  image:
    light: /mark-light.svg
    dark: /mark-dark.svg
    alt: test-inventory
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Output reference
      link: /reference/output
---

## What you get

One JSON document per scan. For each test it has the title, the file, the lines and columns, the describes around
it, the tags, the annotations and the state: active, skipped, fixme, todo, expected to fail, or not loaded when
Playwright would refuse the file. For a state that only applies sometimes, it has the condition and the reason. Each
test also has an id that stays the same when the test moves to another line, and a hash of its body that changes
when its code does, but not when only its formatting or comments do.

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

Read [getting started](/guide/getting-started) to try it, the [examples](/guide/examples) for your setup, the
[query](/guide/recipes) and [CI](/guide/ci) recipes, or the [output reference](/reference/output) for every key.

## Support

If test-inventory is useful to you, [star it on GitHub](https://github.com/Huldoser/test-inventory) or
[sponsor its development](https://github.com/sponsors/Huldoser). Stars help other teams find it, and sponsorship pays
for the time that goes into new framework versions and fixes.
