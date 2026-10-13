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

- Creating a macro that the server refuses shows the server's reason, such as the instance's
  macro cap, instead of a bare "Failed to create macro"; a refused invite shows the server's
  message instead of the raw response.
- Direct messages show their unread badge at sign-in: the client subscribes to this relay's
  direct space as soon as the session exists instead of when Direct messages is opened. It no
  longer asks the direct space for custom emoji, plugins, pipelines, workspace state or
  channels, and Settings hides those tabs there.
- When the server ends the session (a sign-out elsewhere, a password reset, a revoked device, an
  expired session) and closes the live connection with code 4401, the app returns to sign-in
  with "Your session ended. Sign in again." instead of reconnecting with a dead session.
- The desktop app sends the CSRF token that signing in returns and keeps it across restarts, so
  mutations and uploads work against a server on another host, whose cookie the app cannot
  read. A server too old to return the token still signs in as before.
- An invite link opened in a new tab while signed in offers "Join workspace" to that account
  instead of the sign-up form: the page waits for the session to be restored first, and the
  open sign-up page sends a signed-in account on to the app.
- The direct space no longer offers your own account as a contact: the new-message picker
  leaves it out, adding a contact refuses your own contact link, and a contact the server
  refuses shows the server's reason.

### Added

- Message search suggests operator values as you type: `from:` lists workspace members, `in:`
  your channels, `has:` its values, and `before:`/`after:` today's date; ↑/↓ move, Enter, Tab or
  a click inserts, Esc closes the list.
- Deleting your account, from Settings → Account, on a server that offers it: the page says
  what is deleted, that your key identity cannot sign up on this server again and that owned
  workspaces with other members are handed over or deleted first, asks for your username, and
  shows the date the server schedules the deletion for, after its grace period. Until then a
  banner across the app says when, with Cancel. A server's refusal is shown in place, with a
  link to Workspace settings when it is about a workspace you own; a person whose account
  another server holds is sent to their relay.
- In Settings → Workspace, the owner can hand the workspace to another member who is not a
  guest and stay on as a moderator, or delete the workspace with its name typed back, which
  takes it off the rail. Older servers show none of this.
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
- On a server that reports its instance caps (GraphQL `ServerInfo.limits`), the places that
  create things show them before the server refuses: "4 of 5 workspaces" in both new-workspace
  dialogs, which disable Create at the cap with the reason; "3 of 5 devices" in Settings,
  Security, which holds Link a device at the cap; "2 of 5 pipelines", which disables New
  Pipeline at the cap; the registry's plugin count in Workspace settings, Plugins, and a refused
  publish of a new plugin to a full registry; and the cap alone where the client cannot count,
  for channels, macros and daily invites. A new invite asks for no more uses than the instance
  allows, and a refusal for the daily invite cap says it is reached instead of blaming the email
  address. With a message cap, the composer counts UTF-8 bytes near it and refuses to send over
  it in the server's words, keeping the text. A server without the caps behaves as before.
- A new account on probation (`me.probationEndsAt`) sees "New account: you can create workspaces
  and message strangers after HH:MM" across the top of the app until that time, without a
  reload. The new-workspace dialogs give the same reason and hold Create, and the direct space's
  new-message picker says when strangers can be messaged.
- Instance operators (`me.instanceOperator`) get Settings → Instance → Moderation: the
  server's abuse reports with Resolve and a Block principal shortcut, blocked principals with
  Unblock and a block form (optionally cascading to the accounts their invites created) that
  shows what the block did, and the IP deny list with Unblock and a block form taking an
  optional expiry in days. Everyone else, and anyone on an older server, sees no such tab; the
  page says it is for operators only when opened directly.

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
