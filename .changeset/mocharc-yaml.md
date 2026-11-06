---
'test-inventory': patch
---

A `.mocharc.yml` is read as js-yaml, Mocha's reader, reads it. Files that Mocha reads and the scan refused, which lost
every setting and so the files to test, are now read: a byte order mark, a comment or a `%YAML` line before `---`, a
`...` at the end, quoted list items with commas, as `['test/**/*.{ts,js}']`, YAML's escapes in double quotes, as
`\x41`, and a tab or an escaped quote followed by ` #` in quotes. A quote inside a value, as in `grep: buy 'limit # note`,
no longer hides the comment after it, `-a.js` on its own line is a value, not a list item, and what Mocha refuses is
reported rather than read: a key set twice, a tab in the indent, `a: b` in a value, a list inside a list, and values
that start with `@`, `` ` `` or `%`. `-.5` is a string, as js-yaml reads it. A long line is read in linear time; one of
160 KB took 5 seconds.
