---
'test-inventory': patch
---

Follow a setup file a config names with `require.resolve('./global-setup.js')` or `import.meta.resolve('./global-setup.ts')`, also through constants and `path.join()`, as Jest's `globalSetup`, `globalTeardown`, `setupFiles` and `setupFilesAfterEnv` and Vitest's `setupFiles` and `globalSetup` often are, instead of reporting it as worked out at run time, which marked every test of the suite `hasUnfollowedDependencies`. `require.resolve()` of a package reads as the package's name, as it would written directly; a path that isn't there still can't be worked out.
