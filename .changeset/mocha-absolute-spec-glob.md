---
'test-inventory': patch
---

Mocha: an absolute glob in `spec`, as a `.mocharc.js` builds it with `path.join(__dirname, 'test', '**', '*.spec.js')`,
runs the files it matches. The scan matched it against paths relative to the config's folder, found nothing, and
reported `no-files-matched`.
