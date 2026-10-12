# Changelog

What changes between rim-ui releases, for the people who use the web and desktop clients, the
people who run a server with the web client, and the people who write plugins. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); a release is the tag `v<version>`,
the version in `package.json`, and rim-ui releases under the same version as rim-server.

## How entries are written

- A pull request that changes what a user, an operator or a plugin author sees adds its line
  under `Unreleased` in the same pull request. Refactors, tests and internal documentation do
  not.
- Each line goes under one heading: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` or
  `Security`. It says what changed for the reader, not how it was built.
- A change the operator or the user has to act on (a server it needs at a newer release, a
  changed default, a setting that moved) starts with **Upgrade:** and says what to do.
- A change to the plugin protocol or the plugin SDK names the message, type or function.
- At release time `Unreleased` becomes `## [<version>] - <YYYY-MM-DD>` and a new empty
  `Unreleased` starts above it, as rim-server's `docs/operations/release-checklist.md` says.

## [Unreleased]

### Fixed

- Direct messages show their unread badge at sign-in: the client subscribes to this relay's
  direct space as soon as the session exists instead of when Direct messages is opened. It no
  longer asks the direct space for custom emoji, plugins, pipelines, workspace state or
  channels, and Settings hides those tabs there.

### Added

- Release images: every release tag publishes the web client as
  `ghcr.io/rim-platform/rim-web:<version>` (also `<major>.<minor>`, `sha-<short sha>` and
  `latest`), built with the GraphQL endpoint `/api` so it serves any domain, signed with cosign
  keyless by the release workflow and with an SPDX SBOM attested to it and attached to the
  GitHub release. rim-server's `deploy/compose.yml` runs it.
- The server's instance notice (GraphQL `ServerInfo.instanceNotice`) shows as a short plain-text
  banner at the top of sign-in, both sign-up forms and Settings, About.
- On a server with terms of service (`ServerInfo.termsUrl`), sign-up with a password or a key
  asks for "I accept the terms of use" with a link to them, opened in the system browser on the
  desktop and a new tab on the web, and sends the URL back as `acceptedTermsUrl`. A refusal over
  the terms shows at the checkbox. Servers without terms, or older ones, sign up as before.

### Changed

- A rate-limited request (`RATE_LIMITED`, or HTTP 429 `rate_limited` from the server's
  per-address limit) reads "Slow down: try again in N s" wherever a failed change is shown, a
  refused message stays in the composer, and a query retries only after the wait the server
  names.
- A server that blocked this address (HTTP 403 `blocked`) is named as such on sign-in, in the
  connection banner and in the offline banner, instead of reading as offline or signing out.
- A WebSocket upgrade the server refuses for too many connections says so in the connection
  banner and is tried again after 30 seconds, doubling up to five minutes, rather than every few
  seconds. A subscription refused with `TOO_MANY_SUBSCRIPTIONS` raises one notice that some live
  updates are off and is not retried.

[Unreleased]: https://github.com/rim-platform/rim-ui/commits/master
