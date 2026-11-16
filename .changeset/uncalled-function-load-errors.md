---
'test-inventory': patch
---

Keep a file loaded when a call the runner refuses, such as a Jest `describe.each([])`, is inside a describe in a function nothing in the file calls, or in a helper called only from such a function. A describe resets what the scan knows about the function around it, so the call was taken to run while the file loads, and every test in the file was `notLoaded`. It is still reported, as one in a helper body or under a condition is.
