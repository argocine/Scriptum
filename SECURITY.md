# Security Policy

## Supported versions

Security fixes are provided for the latest published Scriptum release. Because
Scriptum is free software, older releases remain available but may not receive
patches; update to the newest release before reporting a problem.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** link on this repository's
Security page. It creates a private report visible to the maintainer. Do not
open a public issue for a vulnerability, and do not attach real or confidential
screenplays to a report.

Include the Scriptum version, operating system, reproduction steps, expected
impact, and a minimal test file if one is necessary. Use invented text in test
files. You should receive an acknowledgement within seven days. The maintainer
will investigate, coordinate a fix and release, and credit the reporter if they
want to be named.

## Security boundaries

The desktop application is intended to operate offline. Its Electron renderer
uses context isolation and sandboxing with Node integration disabled. A narrow
preload bridge validates file access granted by native file dialogs, renderer
HTTP(S) traffic is blocked, permissions are denied by default, navigation is
restricted to application pages, and the only external help URL is exactly
allowlisted. Release builds use ASAR integrity and restrictive Electron fuses.

Document saves use a flushed same-directory temporary file followed by an
atomic replacement, and concurrent saves to one path are serialized. Desktop
crash recovery uses the same durable write path in the application's private
data directory. File byte limits and document-complexity budgets are enforced
before untrusted projects are hydrated and rendered.

The macOS package also removes unused capture-capability declarations and
disables App Transport Security network allowances before signing.

Project files are untrusted input. Parser and file-access boundary tests run on
every supported operating system, while CodeQL and dependency automation watch
the source and locked development toolchain.

## Release authenticity

Current builds are not signed with paid Apple Developer ID or Windows
publisher certificates. macOS and Windows therefore show a first-launch
warning. This is an identity limitation, not a claim that warnings should be
ignored generally. Prefer downloads from this repository's Releases page and
compare them with the published `SHA256SUMS.txt` file. GitHub's release
workflow also creates signed Sigstore/SLSA build-provenance attestations;
verify a download with `gh attestation verify FILE --repo argocine/Scriptum`.
Build from the tagged source if you require an independently inspectable chain
of custody.
