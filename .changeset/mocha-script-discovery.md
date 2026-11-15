---
'test-inventory': patch
---

Without patterns, find the files Mocha runs from package.json scripts: a script that starts `mocha`, `_mocha` or `ts-mocha`, also through the coverage tools `nyc`, `c8` or `mcr`, runs the specs its command line gives, joined with the `spec` that remains, with the `.mocharc` and `mocha` key found from the script's folder, unless `--no-config` or `--no-package` leave them out, and its `--spec`, `--extension`, `--ignore`, `--file`, `--recursive` and `--ui` over the config's. Before, only a config in the root or Mocha's defaults there decided which files ran, so projects that give Mocha its files on the command line, as `mocha 'src/**/*.spec.ts'`, or keep a `.mocharc` in each package, found none.
