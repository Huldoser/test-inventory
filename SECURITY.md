# Security policy

## Supported versions

Security fixes go into the latest release on npm. Before 1.0 there are no maintenance branches, so a fix comes out as
a patch of the latest minor version.

## Reporting a vulnerability

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Huldoser/test-inventory/security/advisories/new), not
in a public issue. Say which version is affected and how to reproduce it; a test file that triggers it helps most.

test-inventory parses the files it scans and never runs them. A file that makes a scan run code, write a file other
than the output, or reach the network is a vulnerability, and so is a problem in a dependency that a scan exposes. A
test that is read wrong is a bug; report it with the
[issue form](https://github.com/Huldoser/test-inventory/issues/new?template=scan-reads-test-wrong.yml) instead.

You get a first reply within 14 days. Once the problem is confirmed, the fix is released as soon as it is ready, with a
GitHub security advisory that credits you unless you prefer not to be named.
