---
'test-inventory': patch
---

A `<script>` block in a Vue or Svelte component whose `type` isn't JavaScript, such as
`<script type="application/ld+json">` in `<svelte:head>`, is no longer read as the component's code. It made the
component unreadable, so the modules its real script imports were missing from `dependencies`.
