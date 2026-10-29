---
'test-inventory': minor
---

`--related <file>` and the `related` filter of `filterInventory()` keep the tests a change to a file can affect: those
whose `dependencies` include it, and those that reach code the scan can't follow, which a change may affect unseen.
`--related -` reads the files from standard input, one per line, so `git diff --name-only origin/main... | npx
test-inventory --framework playwright --related -` lists the tests a pull request can affect. Paths are taken from the
current folder, as git writes them, also when `--root` is a folder in the repository.
