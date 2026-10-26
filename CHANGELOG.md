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

- Your own message that has just arrived in the timeline is treated as yours: its menu offers
  **Edit message** and deletes it as its author, instead of offering **Report message…** and
  the moderator delete that called it another member's message.
- **Open \<panel\>** in the command palette, and a keybind bound to it, opens a web plugin's
  panel instead of saying the plugin is not running.
- A plugin panel's header keeps the panel's title whole; the plugin's name, kind and source are
  shortened instead and show in full on hover.
- The Invite member dialog says the server can't send email invites and to share the link,
  instead of the server's mail setup details.
- Search results show their snippet as plain text, without code fences, emphasis markers or
  link syntax, with matches still highlighted.

## [0.0.3] - 2026-10-26

### Added

- Instance operators can clear a reported person's profile (**Clear profile**, next to **Block
  principal** on abuse reports and reported direct messages): it removes their display name,
  picture, status and bio on this server, with a required reason and an optional lock of 1 to
  365 days.
- **Upgrade:** Clear profile and the note about a locked profile need a rim-server with
  `instanceClearProfile` and `me.profileLockedUntil`. Update the server before the client; until
  then Clear profile is refused and a profile never reads as locked.

### Changed

- Profile settings follow the server's rules for new and locked accounts: while a new account is
  in probation the picture, status and bio cannot be changed (the display name still can), and
  while the server's operators lock a profile nothing in it can be changed until the date shown.
  The probation banner also names the profile picture, bio and status.
- A refused profile picture upload shows the server's reason, such as how many minutes to wait
  before the next upload or that the picture is not allowed, and photos up to 10 MB are taken
  before they are resized for upload.

## [0.0.2] - 2026-10-26

### Added

- Owners and moderators can choose who posts in a channel (**Who can post…** in the channel's
  menu): everyone, or only the owner and moderators, optionally still letting everyone else
  react and reply in threads. Members of such a channel see a bar instead of the composer, and
  the actions they cannot take are left out of the message menus. A server without posting
  permissions keeps every channel open to everyone, and the menu item stays hidden.
- **Upgrade:** posting permissions need rim-server 0.0.2 (`postingPolicy`,
  `postingAllowsThreads`, `setChannelPosting`). Update the server before the client; until then
  the client treats every channel as open to everyone.

## [0.0.1] - 2026-10-25

### Added

- Every account has a password: a PIN of at least 6 digits or a passphrase of at least 12
  characters, chosen at signup and checked with OPAQUE, so the server never sees it. Signing in
  from the sign-in screen's account list asks for it, with **Keep me signed in** (ticked in the
  desktop app, unticked in a browser), and so do linking a device, the locked screen of an
  account whose session is still open, and switching relays. Wrong tries wait from the 4th and
  lock the password at the 10th, until **Use your recovery phrase** sets a new one. Settings →
  Security → **Password** changes it; other devices ask for the new one when they next unlock.
  Recovering an account with its kit offers **I know my password** or **Set a new password**. A
  device whose data was locked under a password reset elsewhere asks once for the recovery
  phrase, or starts empty and keeps signing in with its own key. **Upgrade:** this needs a server
  with account passwords; an expired session no longer signs in again with the device key alone.
- **Sign out** in the user menu and in Settings → Account now asks what to do with the account
  on this device: **Sign out** keeps it, with its keys, cached messages and settings ready for
  the next sign-in, and **Sign out and remove from this device** deletes its keys, its encrypted
  messages and message cache, its relay state and its web plugins' data from this device, with
  every unsent draft kept here.

- A workspace's Owner can turn on one permanent public link in Settings → Workspace → **Public
  link**, after a warning: join directly or ask to join, as a Member or a Guest, with the link to
  copy, joins of the last 24 hours and 7 days, and **Issue a new link** to end the old one. Off
  only pauses the link. Opening it lets an account of the server join, or ask to join with a
  message; someone without an account signs up the server's usual way and comes back to the link,
  which never creates an account. Owners and Moderators accept or decline requests in Settings →
  Moderation → **Join requests**, with a count of open requests there and in the workspace's menu,
  and the person is told when their request is accepted or declined. **Add workspace** opens a
  pasted public link and lists the person's open requests with **Withdraw**.
- A workspace's public link also works for accounts of other servers: pasted into **Add
  workspace** of your own app, it shows the workspace's name and lets you join or ask to join
  through your server, lists the request under **Waiting for approval** with its server, and
  finishes the join when the moderators accept. The Owner can switch off **Accounts from other
  servers can join** in the link's settings, and the link's page points such accounts to their
  own app.
- A person has one context menu wherever they appear: right-click or long-press a message's
  author or an @mention, or a row of a conversation's members or of **Workspace members**, or
  press the ContextMenu key on a focused mention or member row. It offers View profile, Send
  message, Copy @username, adding or removing a contact and, from a conversation's members,
  removing them from it; Owners and Moderators also get Change role, Time out, Kick and Ban
  there. The rows' **⋮** button opens the same menu, and timeouts now offer 10 minutes, 1 hour,
  1 day and 1 week.
- Context menus on messages in the thread panel, pinned messages, search results, attachments,
  links and link previews, notifications and plugin panel headers. A message's menu adds quick
  reactions, Copy selection and Reply in thread, and its labels read in sentence case.
- Right click (or the ContextMenu key, or a long press) on a conversation in the sidebar, a
  sidebar section heading, a workspace on the rail or a message request opens a menu of its
  actions. A conversation's menu is the same as the "…" menu in its header, whose Notifications
  entry is now a submenu, and adds Mark as read, Invite people, Edit topic and Assign keybind.
- **Upgrade:** run a rim-server with `User.handle` (handles), `serverInfo.registrationFull`,
  `abuseContact` and `minimumAge`; the app asks for a person's handle with every message, so an
  older server refuses the timeline. People are shown by their handle, `@username:domain`:
  people of your own server as `@username`, people from other servers with their domain, and
  never by the internal `r_…` name a server keeps for them. **Copy @username** copies the whole
  handle, a mention or a search's `from:` takes a whole handle as well as a username, and the
  `from:` suggestions insert it.
- The sign-in and signup pages show where to report abuse when the server names it, as a link
  for an https address and as an email address otherwise. A server with a minimum age has the
  signup ask "I am at least N" beside the terms; the account is not
  created without it, and a refusal because the server's age changed unticks the box and says so.
- A server that holds as many accounts as it takes says "This server is full", with a link to
  running your own server, on the sign-in page, instead of the signup forms, and when the
  desktop app checks it under **Use another server**; a key signup reads it from the server's
  discovery document before any proof-of-work, and a signup the server refuses as full says the
  same.
- **Upgrade:** run a rim-server with the `workspaceInvites` query and the `revokeInvite`
  mutation. Settings → Workspace → **Invites** lists a workspace's invites to its Owner, newest
  first, with each one's role, uses, expiry, creator and state (Active, Expired, Used up or
  Revoked), and **Revoke** ends an active one after a confirmation. The invite dialog asks how
  long a new link lasts: 1 day, 7 days (the default) or 30 days, the most a server allows.
- On a server whose operator switched off profile pictures (`avatars` in
  `RIM_FEATURES_DISABLED`), Settings → Profile shows your initial with "Profile pictures are
  switched off on this server" instead of the upload, and Settings → About lists Profile
  pictures among the server's features.
- Settings > Notifications sets how notifications look on this device: the message preview
  (sender and text, sender only, or nothing), what the title names (the conversation, the
  sender, or both), and whether encrypted messages show their text. An example shows the
  result. An earlier "Show message preview" choice carries over.

### Changed

- The desktop app no longer shows the webview's own right-click menu (reload, inspect) where
  the app has no menu of its own; text fields, the composer and selected text keep the cut,
  copy and paste menu. A message's context menu also opens with a touch held for half a second.

### Fixed

- Failed message sends retain the draft and selected files. If the message arrives but its
  files fail to upload, **Retry files** resumes the unfinished uploads without sending the
  message again. Retries remain available when returning to the conversation while the account
  stays unlocked; reloading the app or locking the account discards the retained files.
- Plaintext attachments upload to and download from the workspace's host, including inline
  media. Unsupported or oversized selected files are rejected before sending the message.
- Encrypted attachments wait for upload completion before loading inline, and cached messages
  receive attachment metadata updates without consuming their decryption key again.
- Reactions, pins and threads show in encrypted conversations, on the desktop and in the
  browser: a reaction no longer disappears after you add it or after a reload, and a message
  that starts a thread shows its thread.
- Groups without a title are named after their other members ("Alice and Bob", "Alice, Bob,
  Carol and 2 others") in the sidebar, the header, the members panel, Forward and notifications,
  instead of "Untitled".
- Every field that asks for your existing password reads "Password or PIN" (sign-in, unlock,
  the recovery kit's "I know my password or PIN", changing the password, switching relays), so
  an account with a PIN no longer looks as if it needs a passphrase.
- Accepting a message request shows what the sender wrote while it waited, without a reload.
- A message request opened with **Read first** shows **Accept**, **Ignore**, **Block** and
  **Report** in place of the composer: you reply once you accept, and until then the sender sees
  nothing from you. Before, a reply went out while the request stayed pending. **Upgrade:** a
  rim-server with the matching change refuses such posts on its side too.
- **Read first** on a message request from someone on the same server opens the conversation
  instead of saying it could not be verified.
- Notifications of encrypted messages show the message's text, in the notification list and in
  desktop and browser notifications, instead of "Attachment" or nothing. A notification that
  arrives before its message is decrypted waits for it, up to 4 seconds; a message this device
  cannot read shows "Encrypted message".
- Install hash-pinned browser plugin links through the authenticated RIM server, with explicit compatibility and validation errors, and valid CSP origins for relative API endpoints.
- Refresh member pictures, message authors and the signed-in profile when a profile update arrives from another session.
- **Upgrade:** update the server before this client: message queries now require the workspace
  author fields `banned`, `bannedUntil` and `banReason`, and default-workspace joining uses
  `joinDefaultWorkspace`. Keep readable kick and ban reasons until dismissed, show active
  author bans, and let older accounts join the default workspace from direct messages.

- Workspace reports have a dedicated Moderation tab, a Reports menu item, and a pointer from
  instance moderation; report confirmations name the workspace.
- Hover tooltips stay within the window edges and flip using their measured height.
- Accounts without a workspace open direct messages. Removal notices remain visible, and
  departed authors keep their names with a former-member marker instead of an identifier.

- **Upgrade:** run a rim-server with `MessageReport.messageAuthorPrincipalId` for the reported
  direct messages in Settings → Instance → Moderation. A reported unencrypted message of a DM
  or group there now shows its text, with a note that the rest of the conversation is not
  shown, and an instance operator can delete it; the author is named by their principal when
  the operator shares no conversation with them, with a Block principal action that fills in
  the block form. The abuse reports load more with Load more instead of stopping at the oldest
  100.
- The signup forms refuse a display name over 64 characters before sending it, the limit the
  server keeps for every display name; they allowed 80, which the server then refused.
- A sandboxed plugin has no WebRTC: `RTCPeerConnection` and the other WebRTC constructors are
  `undefined` in its frame and its panels, so it can no longer send what it reads to a STUN or
  TURN server of its choosing without `network.fetch`. The permission prompt now says that what
  a plugin is shown could still leak out in small ways, such as a DNS lookup.
- An update that lists other sites in `network_origins` no longer keeps `network.fetch`
  approved: a git update opens the permission prompt naming the new sites, a workspace registry
  update waits behind **Update \<name\>?**, and the plugin has no network until it is approved
  again.
- Reporting a message in a DM or group says where the report goes: to the people who run the
  server, since a DM has no workspace moderators. The instance operators see these reports in
  Settings → Instance → Moderation under "Reported direct messages", with the verified content
  of an encrypted message, Delete, Resolve and Dismiss. Needs a server that routes these
  reports to its operators. The abuse report list says when it shows only the oldest 100.
- The desktop app shows profile pictures uploaded to the server, in the profile settings and
  wherever a person appears, and images and videos attached to messages; until now they showed
  as a broken image. Attachments above 5 MB wait for a click before they download, as encrypted
  ones do. In both apps a profile picture that cannot be loaded shows the person's initial.
- The web app built with a relative endpoint such as `VITE_GRAPHQL_ENDPOINT=/api`, as the
  released web image is, reaches the server it is served by: until now every request failed
  before it was sent, so sign-in failed and the login page could not tell whether the server
  takes signups.
- The desktop app reads a server's discovery document that carries its unsigned `features` or
  `registration` beside the descriptor, and both apps verify a descriptor that declares a
  `handleDomain` or an `abuseContact`; until now such a server could not be pinned, signed up on
  with a key, or used as a relay.
- The new-message picker in Direct messages offers the people in your workspaces as well as
  your contacts, each person once, so an account with no contacts yet can start a DM there as
  it can from a member's profile card.
- The web app served on a domain of its own, apart from its server's (such as
  `chat.example` for a server at `relay.example`), names the server by the origin its signed
  discovery document declares: profile cards, contact links, delegations, relay switches and new
  DMs list the server's own address, About and Delete account show its host, and a device-link
  code from the browser works in a desktop app set to the server's address, and the other way
  round. A key signup without an invite on a server that asks for a proof-of-work works there,
  and when the server's registration cannot be read the form says so instead of sending a
  signup the server would refuse.
- **Upgrade:** run a rim-server that pages `myMlsWelcomes` (the `after` and `limit` arguments
  and `MlsWelcome.createdAt`); against an older server this device can no longer join
  encrypted conversations. A device with more than 100 waiting invitations to encrypted
  conversations joins them all at once (up to 300 per server in one pass) instead of 100 at a
  time, and a conversation with a member whose device holds too many waiting invitations no
  longer commits an empty change each time it checks its members: that device is added once
  it has room again.
- **Upgrade:** run a rim-server with the `userCommand` and `userCommands` queries. Editing a
  user command in Settings → Commands loads its saved title, description and steps, with each
  step's arguments, instead of asking for the steps again, and the list shows how many steps
  each command has.
- When the agent asks to run a command after reading messages or other tool output in the same
  run, the confirmation dialog warns "This action was suggested while the agent was reading
  external content" and asks you to type the command's verb before a Mutating command runs.
- **Install from link** on the desktop installs a bundle from a GitHub release asset, or any
  other `https://` host that does not allow cross-origin requests: the desktop app fetches
  the link itself. The web app still needs a host that sends `Access-Control-Allow-Origin`,
  such as GitHub Pages, `raw.githubusercontent.com` or jsDelivr, or the workspace's plugin
  registry.
- A workspace plugin registry entry whose bundle is a GitHub release asset, or on any other
  `https://` host that does not allow cross-origin requests, installs and updates on the
  desktop: the desktop app fetches it itself, as **Install from link** does. The web app still
  needs that host to send `Access-Control-Allow-Origin`.
- A server command run from the palette, a keybind or the composer's `/` list acts on the open
  conversation and thread, as it does from the AI agent: marking a conversation read, setting its
  notification level or its slow mode no longer fails or asks for the conversation. A
  conversation given in the command's arguments still takes precedence.
- A macro run from Settings → Macros or `/macro` acts on the open conversation and thread: a
  step that marks a conversation read, sets its notification level or its slow mode no longer
  fails without a `conversation_id` in its arguments. A macro that asks for confirmation runs in
  the conversation that was open when it started, even if you move to another one meanwhile.
- The first encrypted message to someone who set up encryption moments earlier goes out instead
  of failing with "Failed to send the encrypted message" until a minute later. When someone in
  the conversation really has no device set up yet, the composer says "<name> has no device set
  up for encryption yet".
- **Install from git URL** installs a web plugin from a repository that keeps its sources
  beside the built plugin: the desktop takes `rim-plugin.json`, the entrypoint and `panels/`
  from the checkout and ignores the rest. A local-process plugin whose `package.json` lists
  only `devDependencies` no longer asks to run `npm install`.
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
- On desktops with WebKitGTK 2.54, such as current Linux distributions, a local-process
  plugin's panel and a web plugin's panel load instead of hanging until they time out.
- Uninstalling a plugin on the desktop deletes the folder the app installed it into, so the
  plugin can be installed again, and turns an enabled plugin off first instead of failing with
  "must disable first". Removing or replacing a plugin with many files no longer holds up other
  plugin actions, and an update interrupted during `npm install` keeps the previous version.
- Choosing a conversation closes a plugin panel that covers the main area, such as Kubernetes
  Pods, and Escape closes it too. Panels in the tool panel stay open.
- A plugin panel in the tool panel stays within its column instead of spilling over the
  conversation, and a long header line is cut short.
- Plugin panels receive `conversation.changed` with the open conversation's id, or `null` when
  none is open, when they load and whenever it changes. The message was declared but never
  sent; only a plugin with `chat.read` approved gets it.
- **Dismiss** on a plugin's changed-bundle warning in Settings → Plugins hides the warning on
  this device until the files change again, and stops the plugin if it is running; the "Bundle
  changed" badge brings the warning back. The plugin's switch can turn a changed plugin off;
  only turning it on waits for **Trust new version**.
- Invite links copied in the desktop app open: they use the server's address instead of the
  app's own.
- An invite link creates an account on a server with open registration instead of being
  refused for carrying a token, and **Join with an invite code** in Add workspace takes a
  pasted invite link as well as the bare code.
- Accented letters, emoji and other non-ASCII text in the AI agent's streamed answers on the
  desktop no longer turn into replacement characters now and then.
- A command the AI agent runs with a thread open gets that thread's id instead of its root
  message's, which the server did not recognise.
- Keybind rows from the server's default layer in Settings → Keybinds show a **Default** tag and
  an **Override** button that opens the add form with their keys, command and context, instead
  of a switch and keys that did nothing.
- Editing a user command no longer saves it without steps: its saved steps cannot be loaded
  here, so the form says new ones replace them and Save waits for one. The macro and pipeline
  editors offer only commands the server runs as steps, and a step already set to one it
  refuses or skips shows a warning.
- Settings → State names its scopes Workspace and User instead of Server.
- The notifications panel shows a notification about a reaction, labelled "Reaction", instead
  of failing to render it.
- When a desktop build's updater settings are unusable, the "updates disabled" warning reaches
  `rim.log` instead of being lost.

### Added

- **Plugin settings.** A plugin's manifest declares its settings in `settings_schema`, with
  the new optional fields `default`, `min`, `max`, `options` and `placeholder`, and a plugin
  that declares any gets **Settings** on its row in Settings → Plugins and in the side rail's
  Plugins menu: a form with a text field, number field, switch or list per setting, **Save**
  that names the field that is wrong, **Cancel** and **Reset to defaults**. Values are kept per
  account on the device and deleted on uninstall. A secret setting is kept in the desktop's
  secret vault and shows only "Configured" once saved, with **Replace** and **Clear**; the web
  app offers none. A manifest whose `settings_schema` breaks a rule, such as a `value_type`
  other than `string`, `boolean`, `integer`, `path` or `enum`, no longer installs
  (`INVALID_SETTINGS_SCHEMA`); `manifestRules.ts` gains `validateSettingsSchema` and
  `settingValueError`.
- **Plugins read their settings.** A running plugin of either kind gets the values you saved,
  over the defaults, with the new protocol v1 request `rim.settings.get`, and the whole set again
  in the notification `rim.settings.changed` after every save or reset and after every sign-in,
  sign-out or account switch. On the desktop a secret setting reaches only its own plugin, in
  plain form; while the secret vault cannot be read, `rim.settings.get` answers `INTERNAL_ERROR`
  with `data.reason: "secretsLocked"` and no change is sent. A plugin's panel can open its own
  settings form with the panel bridge message `rim.settings.open`, and never sees the values;
  `rim.settings.get` and `rim.settings.set` from a panel, which only ever were logged, are gone.
- Plugin SDK 0.2.0: `host.settings.get()` and the type `Settings`, `onSettingsChanged(values,
  host)` in `definePlugin`, and in `@rim-platform/plugin-sdk/testing` the `settings` option of
  `startTestHost` and `TestHost.changeSettings(values)`. On an app from before settings,
  `host.settings.get()` rejects with a `HostRequestError` whose code is `METHOD_NOT_FOUND`. The
  template plugin has a `greeting` setting.
- **View details** on a plugin's row in Settings → Plugins opens a dialog with its whole
  description, under "From the plugin author:" and shown as plain text, its id, version,
  author, kind, source and signature, each permission it asks for and whether it is granted,
  the sites it may reach and its commands. The row shows the first two lines of the
  description.
- **Update** on the row of a plugin installed from a git URL in Settings → Plugins (desktop)
  fetches its repository and moves it to the newest commit, then says "Updated to v<version>",
  "Already up to date" or why it failed. Install steps ask for consent first, a running plugin
  restarts on the new files, approvals carry over for the permissions it still asks for, and a
  new permission opens the permission prompt. A plugin installed from a link says that it is
  updated by installing the new version's link.
- **Who can message me** in Settings → Direct messages: choose whether people outside your
  workspaces can send you a request or nobody can, and for each workspace whether its members'
  DMs arrive directly or as requests. When your server's operator or one of your workspaces
  closes DMs from outside, the setting says who did. Contacts, and a workspace's owner and
  moderators, always reach you directly.
- A workspace owner sets in Settings → Workspace → Direct messages whether people outside can
  message its members (no floor, at least a request, or closed) and whether members' DMs to each
  other arrive directly or as requests. Moderators see these settings read-only, and About
  shows the DM settings of your server's operator.
- Message requests are split by where they come from: a workspace's requests sit under
  "Requests" at the top of its Conversations, and requests from outside your workspaces at the
  top of Direct messages, so a stranger's message never looks like a colleague's. The bell
  still counts them all. A DM you sent that waits for acceptance says so, and says when the
  rest of your messages wait for it; the other person's presence and typing stay hidden until
  they accept.
- A plugin command can act on the conversation you are in: one that declares
  `required_context: ["conversation"]` in `rim-plugin.json` gets `conversation_id` and, with a
  thread open, `thread_id` in its `args`, and `["message"]` gets the message it was run on. Such
  a command only shows in the palette while a conversation is open, and a keybind or the AI
  agent says "Open a conversation first" instead of running it. A manifest that also declares
  an argument of one of those names no longer installs.
- The plugin SDK is published to npm as `@rim-platform/plugin-sdk`, starting at 0.1.0, with a
  version of its own. It ships JavaScript and type declarations, so a plugin runs with
  `node main.ts` against the installed SDK without bundling first.
- `@rim-platform/plugin-sdk/testing` exports `validateManifest`, `parseManifest`,
  `parseManifestText`, `checkInstall` and `ManifestError`: the rules the hosts install a
  `rim-plugin.json` by, for checking a plugin's manifest in its tests.
- `rim-plugin-bundle --in-place --entry <source>` builds a plugin into the `main.mjs` beside its
  manifest, as a plugin repository commits it, and `rim-plugin-bundle --check` exits 1 naming
  each file when the committed `main.mjs` or `panels/` differ from a fresh build. Bundles no
  longer depend on the folder the bundler runs from.
- A key signup creates the account first and shows the recovery kit after it,
  with "I saved it" and "Later", in the web app and the desktop app. Until the kit is
  confirmed, a bar across the app says "Save your recovery kit" and reopens it.
- Before the web app creates keys, it asks the browser to keep this site's data. When the
  browser refuses, it says the recovery kit would then be the only way back and goes on only if
  the person accepts.
- The recovery kit screens suggest linking a second device from Settings > Security.
- The web app can hold an account's identity in the browser, as non-extractable keys in its
  own storage: creating an account with a key on the join pages, recovering an account with its recovery kit, replacing the identity key,
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
- After signing in on a device that holds none of the account's keys, the app offers "Set up
  encryption for this account", which links the device to the keys the account has elsewhere.
  "Later" holds it back for seven days, and "Set up encryption" in the "Not encrypted" dialog
  brings it back.
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
- On a server with terms of service (`ServerInfo.termsUrl`), sign-up asks for "I accept the terms of use" with a link to them, opened in the system browser on the
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
- Desktop installers on every release: an AppImage, a `.deb` and an `.rpm` for Linux x86_64
  and an installer (`-setup.exe`) and an `.msi` for Windows x86_64, attached to the GitHub
  release with a cosign-signed `SHA256SUMS` and a build provenance attestation for each; the
  release notes say how to verify them. The Linux builds need glibc 2.34 and WebKitGTK 4.1, as
  on Debian 12, Ubuntu 22.04 and newer. macOS follows later.
- The desktop app updates itself from the GitHub releases: it checks at launch and every day,
  and Settings, About downloads a signed update and installs it after "Restart to update". An
  app installed from the `.deb` or `.rpm` updates with the next package and asks for an
  administrator password.
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
- Uninstalling a plugin in Settings → Plugins asks first, and the dialog says whether the
  plugin's files are deleted.
- Each panel of a running plugin has an **Open <panel>** command, so the palette or a keybind
  opens it. A keybind to a panel whose plugin is not running shows an error.
- The "Welcome to RIM" screen of an account without a workspace offers **Join with an invite
  code**.
- The sign-up form takes an **Invite code**, the bare code or a whole invite link. An
  invite-only server requires it, a proof-of-work server takes it in place of the proof, and on
  an open server a workspace invite joins that workspace once the account exists. The sign-in
  page offers "Create account" on invite-only servers too and says an account there takes an
  invite.
- The web app says, under Set up encryption and in Settings → Security, that encrypted messages
  are kept only in this browser and that clearing the site's data deletes them, and points to
  the desktop app's history archive for a lasting copy.
- `rim-plugin-bundle` without `--entry`, in a folder whose manifest's entrypoint is a `main.mjs`
  that exists, packs that file as it is instead of rebuilding it, so the `.rimbundle` matches
  the committed build. `--entry` still builds from source.
  A web plugin's committed `main.mjs` that starts with a hashbang is refused with the reason,
  since the browser cannot load it and the copy keeps the committed bytes.

### Changed

- The side rail's **Plugins** menu lists only the panels of the running plugins, then **Manage
  plugins…**; the per-plugin Settings rows left it. A plugin's settings now open from a settings
  button in the header of its panel, from **Plugin settings: \<plugin\>** in the command
  palette, which a keybind can run, and from its row in Settings → Plugins as before. From the
  panel, the palette or a panel's `rim.settings.open`, the form opens over what is on screen, so
  closing it leaves you in the plugin instead of in Settings.
- A plugin is turned on when you install it: the Plugin Permissions dialog that ends every
  install, from a folder, git, a link or the workspace registry, now has **Approve and turn on**,
  which grants the permissions and starts the plugin. **Cancel** leaves it installed and off, as
  every install did before. Opened later from the plugin's menu, the dialog still only approves.
- A plugin's row in Settings → Plugins no longer squeezes its name and description into a
  narrow column: the name, version and state sit on one line, the kind, signature and source
  are chips, and only **Update**, **Settings**, the switch and a **⋯** menu sit beside them.
  **Permissions**, **Activity**, **Sign and publish…** and **Uninstall…** moved into that menu.
- The version starts at 0.0.1, the first public release, which rim-server shares: Settings,
  About and plugins (`hostVersion`) report 0.0.1 instead of 0.1.0.
- The app carries the RIM brand: the RIM wordmark heads the sign-in and join pages,
  the browser tab shows the RIM icon and the title "RIM", and restoring a session shows the
  bouncing RIM splash, still when the system asks for reduced motion. The desktop window and
  its installers are named "RIM".
- A direct message is created when its first message is sent, not when the person is picked:
  picking one person (in New message, or with Send DM on their card) opens the DM you already
  have with them, or a draft shown as "New message to <name>" that leaves nothing behind if you
  send nothing. The draft says when the conversation will be end-to-end encrypted. Groups are
  still created at once.
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
- The Kubernetes Pods and GitHub Pull Requests plugins live in repositories of their own,
  [`plugin-k8s-pods`](https://github.com/rim-platform/plugin-k8s-pods) and
  [`plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs), and are no longer
  in `plugins/`. Each holds the built plugin at its root for Install from git URL and attaches
  a `.rimbundle` to its releases; GitHub Pull Requests now starts with rim-ui and rim-server
  in its list.
- Plugin panels are listed in a menu under **Plugins** in the side rail, one row per panel of
  each running plugin, instead of a puzzle icon each; with none, the menu links to Settings →
  Plugins. The plugin list in the tool panel, whose rows did nothing, is gone, and a crashed
  plugin shows its state in Settings → Plugins.
- **Invite member** shows only for the workspace's owner, the only role the server lets invite.
- **Upgrade:** a command whose `required_capabilities` names a capability the manifest's
  `capabilities` does not declare is refused at install with `UNDECLARED_CAPABILITY`, instead of
  failing when it runs. The SDK's `validateManifest` applies this rule and the capability rule
  under Security. A plugin installed earlier that breaks either rule is skipped at launch:
  reinstall it from a fixed manifest. An install refused for its manifest shows the reason
  instead of raw JSON.

### Removed

- Sign-in and signup with a username and password, the email password reset and "Set up key
  sign-in": every account signs up with a key and a password. **Upgrade:** needs a server of this
  release.
- The decision records left `docs/`, which now holds only pages on how the client works today;
  git history keeps the records.
- Simple mode: a plugin folder or repository without `rim-plugin.json` no longer installs from
  comment headers in `main.ts`, `main.js` or `main.py`, which never started. Install says every
  plugin needs `rim-plugin.json` at its root.

### Security

- On the desktop, what the app keeps for an account opens only while that account is unlocked:
  its device key, identity key, backup key and recovery phrase, its pending device links, its
  message cache and its plugins' secret settings are sealed under the account's own data key. An
  account that is not kept signed in on the computer no longer opens offline; the sign-in screen
  says that signing in needs a connection to the server. The message cache is rebuilt from the
  server once, under a new key per account.
- A server's discovery document is accepted only when its server-to-server endpoint is the
  origin it was fetched from or a path under it. Before, a longer host that merely started the
  same passed, so another server's document replayed at `https://host.exam` could be pinned
  there under the identity of `https://host.example`.
- A desktop plugin whose files changed while the app was closed no longer starts at launch. It
  waits for **Trust new version**, which starts it if it is switched on.
- Installing a plugin refuses capability names other than the built-in ones, and
  `network.fetch` for a web plugin, in the manifest's `capabilities` and in each command's
  `required_capabilities`, naming the key. A `plugin.<id>.<verb>` key used to install although
  no permission prompt could approve it.
- The web app keeps each account's data in the browser encrypted under a key that only the
  account's password, its recovery phrase or a kept session opens: its keys, encrypted messages,
  relay state, web plugins' data, drafts, removal notices, pending join requests and the agent's
  conversations. Until the account is unlocked the app shows nothing of it, and signing out locks
  it again. **Upgrade:** the web app drops what earlier versions kept in the browser, keys
  included; an account used in a browser before signs in there again after recovering it with
  its recovery phrase or linking the browser as a new device.
- A web session signed in without "Keep me signed in" lasts until the browser closes and opens
  nothing without a secret the tab holds in memory, so a session cookie left in the browser is
  worthless; reloading the page within a minute keeps the account open.

[Unreleased]: https://github.com/rim-platform/rim-ui/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/rim-platform/rim-ui/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/rim-platform/rim-ui/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rim-platform/rim-ui/releases/tag/v0.0.1
