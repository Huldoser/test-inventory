---
description: Scan React, Vue, browser mode, in-source tests and monorepos with test-inventory.
prev:
  text: Vitest guide
  link: /frameworks/vitest
next:
  text: Query recipes
  link: /guide/recipes
---

# Vitest examples

These examples use Vitest throughout. Start with the [Vitest guide](/frameworks/vitest) for installation,
your first scan and framework-specific limits. Each example shows a project's file layout; adjust its globs to
your own suite. Scanning reads the source without running tests or starting a browser.

## React with Vitest and Testing Library {#react-with-testing-library}

<!--@include: ../guide/examples.md#example-vitest-react-->

## Vue with Vitest and Vue Test Utils {#vue-with-vue-test-utils}

<!--@include: ../guide/examples.md#example-vitest-vue-->

## Vitest browser mode

<!--@include: ../guide/examples.md#example-vitest-browser-->

## In-source and type tests

<!--@include: ../guide/examples.md#example-vitest-in-source-->

## A Vitest monorepo {#a-monorepo}

<!--@include: ../guide/examples.md#example-vitest-monorepo-->

## Next

- [Vitest configuration and limits](/frameworks/vitest#configuration-and-limits).
- [Query recipes](/guide/recipes): filter by state, tags and other fields.
- [All framework guides](/frameworks/): scan another runner in the same project.
