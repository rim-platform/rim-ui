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

- The new workspace, add workspace and new channel dialogs keep the cursor in their name field
  instead of moving it to the Close button a moment after they open.
- "<name> is typing..." goes away as soon as that person's message arrives instead of lingering
  for a few seconds, and the first keystroke after sending announces typing again at once.
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
- The typing indicator names who is typing instead of "undefined is typing...": it uses the
  name a contact was given here, the name the server sends, or the workspace's member list,
  and says "Someone" when none of them knows the person.
- A workspace joined from an invite link while signed in shows in the workspace rail at once,
  without reloading the page.
- The Inbox unread badge no longer comes back for conversations already read: opening a
  conversation and reaching its newest message tells the server it is read, as does a new
  message arriving while you are at the bottom.

### Added

- On a server that takes key signups only (rim-server's default from this release), the join
  pages offer only "Create account with a key". A browser that cannot create keys says so and
  points to the desktop app instead of showing a password form, and the sign-in page does the
  same in place of its "Create account" link.
- A key signup or enrollment creates the account first and shows the recovery kit after it,
  with "I saved it" and "Later", in the web app and the desktop app. Until the kit is
  confirmed, a bar across the app says "Save your recovery kit" and reopens it.
- Before the web app creates keys, it asks the browser to keep this site's data. When the
  browser refuses, it says the recovery kit would then be the only way back and goes on only if
  the person accepts.
- The recovery kit screens suggest linking a second device from Settings > Security.
- The web app can hold an account's identity in the browser, as non-extractable keys in its
  own storage: key sign-in set up from Settings > Security, creating an account with a key on
  the join pages, recovering an account with its recovery kit, replacing the identity key,
  removing devices, publishing the profile card, and linking other devices with a code. The
  browser asks to keep its storage so the keys are not evicted, and stops before anything is
  sent when it cannot write them. Plugin manifest signing and the identity key backup in the
  history archive stay in the desktop app.
- A new direct message or group is end-to-end encrypted whenever your device is set up for
  encryption: members without such a device are invited, shown as "Invited" in the members
  panel, and see the conversation marked "Invited" with Join, Set up encryption or Decline.
- A direct message or group that is not end-to-end encrypted says so: a dialog the first time
  you open it on a device names who has not set up encryption, and a "Not encrypted" mark in the
  conversation header shows it again.
- After signing in with a password, the app offers "Set up encryption for this account": the
  desktop app creates the account's keys and shows the recovery kit, and a device of an account
  that already has keys elsewhere is offered to link to them. "Later" holds it back for seven
  days, and "Set up encryption" in the "Not encrypted" dialog brings it back. The join form
  keeps the key as its default and shows the password signup as a smaller link.
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
- Each workspace in the workspace rail other than the open one shows an unread badge, like
  Direct messages; the counts are refreshed every minute and when the window regains focus.
- The desktop app's sign-in and join pages name the server they use and offer "Use another
  server": enter a self-hosted server's address, see its version, and the app moves to it.
  "Back to the default server" returns to the one the release was built with. Only `https://`
  addresses are accepted, and `http://` for localhost.
- Settings > About has "Third-party licences": the desktop app opens the notices bundled with it,
  and the web app links to the same file attached to each release.
- Settings > About names the connected server by its host, with its version and API version,
  so a bug report carries both.
- The desktop app keeps a log file, `rim.log` in the system's log folder, rotated at 2 MB with
  four old files kept; Settings > About has "Open log folder". It holds the app's and the web
  view's warnings and errors with no message text, keys or tokens. `RIM_LOG=debug` adds more
  detail for a bug report.

### Changed

- The app carries the RIM brand: the RIM wordmark heads the sign-in, join and password pages,
  the browser tab shows the RIM icon and the title "RIM", and restoring a session shows the
  bouncing RIM splash, still when the system asks for reduced motion. The desktop window and
  its installers are named "RIM".
- A direct message is created when its first message is sent, not when the person is picked:
  picking one person (in New message, or with Send DM on their card) opens the DM you already
  have with them, or a draft shown as "New message to <name>" that leaves nothing behind if you
  send nothing. The draft says when the conversation will be end-to-end encrypted. Groups are
  still created at once.
- After turning on key sign-in, Settings > Security says every other session of the account was
  signed out, which the server now does at enrollment, instead of offering to sign them out.
  Account settings keeps "Sign out other sessions".
- The desktop app keeps a new account's recovery kit in its encrypted secret vault, next to the
  identity key, until you confirm you saved the kit, and then deletes it, as the web app already
  does. A kit you confirm before the account is created is never written, and a recovery with
  the kit keeps nothing of it.
- "<name> is typing..." is shown in direct messages only. Channels, groups and threads show no
  typing, and the app no longer announces typing there.
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
