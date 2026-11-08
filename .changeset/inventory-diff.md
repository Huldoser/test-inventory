---
'test-inventory': minor
---

Compare two complete saved scans with `test-inventory diff old.json new.json` or `diffInventories(before, after)`.
Reports additions, removals, renamed and moved tests, changed code and dependencies, state, tags and other metadata.
Matches ids first, then body hashes with file, suite or dependency context, leaving ambiguous matches unmatched.
Includes exact body clone groups, JSON Schema, and escaped Markdown output through `--format markdown` or
`formatDiffMarkdown`. Hash comparisons and rename matching require identical tool versions; incomplete scans warn.
