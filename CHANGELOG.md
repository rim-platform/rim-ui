# Changelog

What changes between rim-ui releases, for the people who use the web and desktop clients, the
people who run a server with the web client, and the people who write plugins. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); a release is the tag `v<version>`,
the version in `package.json`. rim-ui releases on its own, with its own version numbers: a
deployment runs the web client at `RIM_WEB_VERSION`, apart from the server's `RIM_VERSION`.

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

## [0.0.13] - 2026-11-14

### Added

- Home starts with a Getting started box: a short list of first things to try, such as opening
  the first channel, the command palette, Unreads, plugins, webhooks, the Assistant and agents,
  each a click away. **I'm done with this** takes it off Home, and **Add a box** brings it back.
  A saved layout is left as it is. The Getting started guide gains a "What do you want to do?"
  section with eight common tasks in a few steps each.
- A new account opens its workspace's first channel, once, instead of "Select a conversation".
  Signing in later or switching workspace opens nothing.
- Plugin SDK 0.3.0: `host.commands.execute(commandId, args)` with the types `Commands` and
  `CommandRunResult`, which asks the app to run one of its own commands the person granted and
  resolves with how the run ended, never the command's output; in the generated
  protocol `Method.runCommand`, `RunCommandParams`, `RunCommandRequest`, `RunCommandResult` and
  `RunCommandResponse`; in the manifest `read_only` on a command and the top-level
  `runs_commands`, with the constants `MAX_RUNS_COMMANDS`, `MAX_COMMAND_ID_BYTES` and
  `AGENT_MANAGEMENT_COMMAND_IDS` and the functions `isCommandId` and `unrunnableByPlugins`.
  `checkInstall` refuses a command that is both `read_only` and `dangerous`, and checks the
  `runs_commands` rules.

### Changed

- Settings > Bots & webhooks lists a channel's revoked webhook, with when it was revoked and a
  **New webhook** button, when the channel has no active one, so an Owner sees that its alerts
  stopped.
- Making a bot for webhooks is shorter: **New bot for webhooks** (under Incoming webhooks, and in
  the form as **Only posts from webhooks**) fills the two required statements, which stay
  editable. The token dialog says webhooks don't need the token, and the new webhook form says
  to create a missing channel first.
- The plugin permission prompt starts with the encrypted chat permissions unticked, unless they
  were approved before. After **Approve and turn on**, a plugin with a panel says where to open
  it. On the web, the empty Plugins page points to a plugin's release page and the RIM guide, and
  pasting a plugin's GitHub repository link into Install from link says to copy the link from its
  latest release instead.
- The AI agent built into the desktop app is now called the **Assistant**: its Settings tab, its
  panel (<kbd>Ctrl+Shift+A</kbd>, **Open Assistant**), the conversation menu's "Assistant: on in
  this conversation", `/agent` ("Ask the assistant") and the palette's **Assistant & Agents**
  category. Settings has new groups: You, Messaging, Shortcuts & automation, Tools & AI
  (Plugins, Assistant, Agents), Workspace, Instance and About; Emoji moved to Messaging and State
  to Shortcuts & automation. Plugin AI is now the section "Plugin commands it may run" of
  Assistant, Bots is "Bots & webhooks", and Agents starts by saying what agents are for, with a
  link to Assistant. About lists what each part of RIM is for. Keybinds to Settings tabs keep
  working, "Settings: Plugin AI" included, which opens that section as "Settings: Assistant's
  Plugin Commands".
- The Keybinds, Pipelines and State tabs, the lens picker and message requests in the
  notifications panel each say in a line what they are for; the lens button reads "Lenses:
  filtered views of this channel". "Block Principal…" is now "Block Account…", moderation says
  "accounts" for blocked principals, and pointers to Settings pages read "Settings > X".
- Getting started's search row is now "Search and run anything" and opens the search box
  (Ctrl+Shift+F), not the command palette; its shortcut is hidden at phone width. In the command
  palette, the Focus commands and Cycle Recent Activity now list last under Navigation.
- Home's Add a box no longer offers the agent boxes in the web app, where they can't run.
- The Audit log button on the workspace rail shows only to a workspace's Owners and Moderators.
- Link previews show no image, in the web app and the desktop app alike: the image would come from
  another site, which the content policy blocks, and asking for it would tell that site who is
  reading.
- Sign-up and first run read more plainly. The browser-storage warning now says why it appears,
  moves into view and takes focus, and its button reads **Continue**; the recovery kit screen
  says what **Later** means; the password hint says "recovery kit"; and the sign-in page opens
  with "Welcome to RIM" when this device holds no account yet.

### Fixed

- The Plugin Permissions dialog scrolls in a short window: the plugin's description and its
  permissions scroll between the header and the buttons, which stay on screen. Before, Approve
  could sit below the window's edge with no way to reach it.
- The empty Plugins page's link to the official plugins opens the RIM guide's Plugins page; it
  led to a page that doesn't exist.
- New messages in the last conversation you opened count as unread while Home, Unreads or Settings
  is in front of it. They were taken as read, so Home and the rail showed too few.
- A word in angle brackets in a message, such as "reply /vote <number>", now shows as typed
  instead of disappearing. Any HTML in a message shows as the text that was written, never as
  markup.
- A plugin reading a conversation this device has not stored yet, such as the Poll panel in a
  channel on the web, gets its messages once a short history is stored, instead of "not fully
  stored on this device yet": the app now waits up to 5 seconds for it. In the web app, a plugin
  with only "Read your conversations" can read a plaintext channel once the browser has stored
  it, instead of being refused as if the channel were encrypted.
- Ctrl+Shift+A in the web app now says the assistant is in the desktop app instead of doing
  nothing.
- Workspace settings > Public link on a server's default workspace says everyone who signs up
  joins it, instead of showing the server's refusal as an error.

### Security

- Links in messages and link previews open in a new tab that has no access to the app's tab, so a
  linked page can no longer redirect the app to another page. The web image also sends a
  same-origin opener policy.
- The web image sends HTTPS-only (HSTS) and the other security headers on every path, including
  the static assets.
- In the permission prompt, unchecking a permission the plugin already holds now takes it back
  when you approve, in the web app and on the desktop.
- The install text for a sandboxed plugin says that what it is shown can still be sent out in
  small amounts, for example by the plugin navigating its frame, even without network access.
- Link previews the desktop app fetches for an encrypted message come only from the public
  internet: a link to this computer, the local network or a cloud metadata address, or one that
  redirects there, gets no preview. At most three redirects are followed, each checked, and the
  fetch no longer goes through a system proxy.
- The approval card for a program outside RIM shows every argument of the command it asks to
  run in full. One that looks like a secret carries a note saying so instead of showing as
  `[REDACTED]`, so a program can't hide what it asks you to approve. The audit log still masks
  such values.
- The record of what agents were given keeps separate limits per agent for reads, requests to
  change something, refusals and calls that hand over nothing, so an agent can't push what it
  read or changed out of the record with many cheap calls.
- The agents guide explains the risk of the agent port on a computer other accounts sign in to,
  and what to do when the port is held by another program.
- The desktop window is granted only the app's own commands it calls; any other command is
  refused to the page.
- On Windows, the sandboxed plugin frames of the desktop app no longer receive the app's IPC
  key and send function.

## [0.0.12] - 2026-11-12

### Added

- Agent sessions in the desktop app: **Browse…** picks a session's folder in the system's folder
  dialog; the session's header offers the agent's model and its other settings, and remembers the
  model per agent; a notice with **Open** says when an agent finishes or waits while you're
  elsewhere in RIM; and an **Agent sessions** box on Home and a top bar button, which counts the
  sessions waiting for you, list them, running ones first.
- The AI agent's header switches the model in the open conversation: it lists the models of
  every provider with a key set, the conversation carries on with the new model, and "Switched
  to \<model\>" marks where it changed.
- Settings → Agents installs Claude Code, Codex, Gemini CLI, opencode and Goose for you, with
  one confirmation, keeps them up to date and removes their files, shows how big each one is
  before it downloads and how much space they use, and signs you in to them: in a terminal, in
  your browser or by naming the variables to set. A session that finds its agent signed out
  offers **Sign in** and **Try again**.
- **Connect an agent** in Settings → Agents, and the **Connect an Agent…** command, connect Codex,
  opencode, Gemini CLI, Cursor, VS Code or any other MCP tool to the desktop app without a helper:
  name it, and RIM shows its address, its token and a ready-made setup for that tool, once.
- Command forms pick more for you: a workspace state key comes from the workspace's keys with
  their current values, a value to store gets its kind (Text, Number, Yes/No or JSON), a macro
  step can name the workspace to switch to, the macro to run and the pipeline to turn on or off
  from lists, a topic can be cleared with **No topic**, and choices such as a mute's length or a
  scope read as they do elsewhere in the app ("Until I unmute it", "Only me").
- **Agents RIM can start** in Settings → Agents, in the desktop app: add Claude Code, Codex,
  Gemini CLI, opencode, Goose or another Agent Client Protocol program, each confirmed in a system
  dialog with its exact command line, and RIM connects an agent for it with nothing granted. RIM
  never installs one: a program it can't find shows how to install it and sign in.
- **Agent sessions**, in the desktop app: start one of your agent programs in a folder, tell it
  what to do, follow its answers, tool calls, diffs and plan as it works, approve or refuse each
  step it asks about, and cancel or stop it. Desktop notifications say when it waits for you or
  finishes. RIM keeps no transcripts; recent sessions reopen when the agent supports it.
- Command forms pick times as choices: a ban's end, a mute, a notifications pause, a timeout and
  a state entry's expiry offer their presets, a length in minutes, hours or days and, where it
  fits, a date and time, so a macro step saved as "For 2 hours" counts from each run. The form a
  command opens to ask for arguments starts with the current topic, slow mode, posting rule or
  notification level, folds optional arguments under **More options**, and a macro's own form
  asks each step with the same fields as its editor, a cleared topic included.
- **Ask agent…** on a message, and **Ask agent about #channel** on a channel, in the desktop app:
  pick a running agent session or start one, let the agent read that channel if it can't yet, and
  write your question; the agent reads the channel or the message itself, under what you let it
  read. When an agent in a session is refused a channel it can't read, the session offers
  **Let it read #channel**.
- Command forms pick people and conversations from fitting lists: the members of a new group or
  channel, or people to invite, by name as chips; Unban lists the people banned, Clear Timeout
  those timed out and Remove Member the conversation's members; a step that archives, unarchives,
  joins or leaves offers only the conversations it can act on, Navigate to DM your direct
  messages, and a reaction opens the emoji picker. Add to Contacts, Remove from Contacts and Block
  can name the person in a keybind or macro step.
- A macro step that takes a channel now also offers the public channels of the workspace you have
  not joined, so a macro can join them and set their notifications, and a step's message text can
  have several lines (Ctrl+Enter or Cmd+Enter sends it from a form).
- **Upgrade:** with a server that keeps your macros as your own commands (rim-server listing
  `account_macros`), a macro is your own command made of commands, and every macro is a command:
  it shows under Macro in the palette, the keybind picker, Home quick boxes and the composer's `/`
  list in every workspace, on this server or another, and a key to it follows you there. The app
  runs it step by step: one form first asks for every argument the steps ask for, each server step
  goes to the workspace's server with its own confirmation, app and plugin steps run in the app,
  and the first step that fails stops the rest with "Step \<n\> (\<command\>) failed". A plugin
  never runs your macros.
- Settings → Macros makes and edits these macros: a title, a description and up to 20 steps,
  each picked from a searchable list of built-in, app and plugin commands by category, with a
  field for each argument to fix it or **Ask when I run it**. **The AI agent can run this** lets
  the agent run a macro whose steps are all commands the agent may run, run on RIM's server,
  with every argument fixed; otherwise it says why it is off.
- The macros you made in each workspace move into your macros once, and are deleted where they
  were; at 100 macros the rest stay, and a toast says how many stayed where. Those that stayed,
  at the limit or refused by the server, are listed under **Not moved yet** in Settings → Macros
  with the reason, to **Try again** or **Delete**.
- Connected agents outside RIM, such as Claude Code, can ask to run RIM's own commands in the
  desktop app: **Choose its commands** in Settings > Agents has a **RIM commands** section, by
  category, where you tick the ones an agent may ask for. Every call shows an approval card first,
  a dangerous command is only proposed, and a command acts only in the workspaces and channels the
  agent can read. Agents get the tools `rim_list_commands` and `rim_run_command`.
- Plugins can run RIM's own commands: a manifest lists the built-in and app commands it wants in
  `runs_commands`, the permission prompt shows them under "Commands it can run" with nothing
  ticked, and an update that lists more asks again. A plugin calls `host.commands.execute` in the
  plugin SDK (`rim.command.execute` from plugin to host in protocol v1, and from a panel) and
  hears only whether it ran. A command that changes something asks you each time in a card
  naming the plugin; dangerous and restricted commands, other plugins' commands and agent
  commands never run. Granted commands, with Revoke, and every run are in the plugin's row in
  Settings → Plugins.
- Commands for answering, connecting and managing agents in the desktop app: approve or refuse an
  agent's request, connect or turn down a program asking to, disconnect an agent, choose what it
  can read and its plugin commands, and open the runs and the record of what agents were given.
  Approving an agent's request or connection from a key, the palette or a quick box always shows a
  warning first, and none of these commands is ever offered to an agent.
- New commands for replying, editing, forwarding, attachments, message selection, invitations, lenses, conversation invites, notifications and Unreads, so each can be run from the palette, a keybind or a quick box.
- New commands for Settings tabs, signing out, updates, the window, status, profiles, macros and
  pipelines, so every one of these can be run from the palette, a keybind or a quick box.
- New commands for moderation, reports, invites, join requests, bots, webhooks, plugins, contacts, blocking and message requests, so each can be run from the palette, a keybind or a quick box.
- Three new boxes for Home: Direct messages, Channel, which shows the latest messages of a channel
  you pick, and Quick actions, buttons that run commands you choose (`docs/home.md`). Channel and
  Quick actions can be added more than once, each with its own settings, and showing them marks
  nothing read.
- Home is made of boxes you can drag into order, or move from each box's ⋯ menu, resize, add and
  remove, saved to your account (Edit Home, `docs/home.md`). Until you edit it, Home shows today's
  layout. The edit made last wins across devices, an edit made offline is sent when your server
  answers, and a box a device can't run can be hidden on that device alone. It needs a server that
  lists `home_layout`; with an older one, Home stays as it is.
- Webhook formats: New webhook offers Plain, GitHub, the host's other ready-made formats such as
  Grafana, and Custom, and a webhook's row has Edit format. The format editor writes rules as cards,
  tries them on a sample, copies and pastes them as JSON, and drafts them with the person's own AI,
  or a prompt to copy into any AI. Where the host keeps test sessions, it also shows what a service
  really sends, on a test URL that saving keeps. Needs a workspace server that lists
  `webhook_formats`, and `webhook_test_sessions` for the log, in `serverInfo.capabilities`.
- Every member sees a workspace's bots: a Bots section in the conversation list, each opening its
  card, and "n bots" in a channel's header, which shows what each bot's adder says and that RIM
  can't check it. The header also says when an agent you connected can read the channel. Needs a
  workspace server that lists `bot_disclosure`.
- Settings > Pipelines can post a welcome as a bot, and a bot can be allowed to see people joining.
  Each needs a workspace server that lists `pipeline_post_as_bot` or `bot_events` in
  `serverInfo.capabilities`.
- A channel's menu can make its incoming webhook.
- Unreads: one page with every unread message across your workspaces, where a message stays until
  you mark it read. It's on Home, in the conversation list and on `workspace.open_unreads`.
- A message or a conversation can be marked unread, on all your devices, and marking everything
  read can be undone for a few seconds. Marking unread needs a workspace server that lists
  `read_marker` in `serverInfo.capabilities`.
- Home: one page across your workspaces with what's waiting for you, your mentions and
  replies, your unread counts and your agents' runs. It's in the workspace rail and on
  `workspace.open_home`.
- Narrow windows work: side panels become a drawer, and threads, pins and plugin panels open
  over the conversation instead of squeezing it. Settings shows its sections as one menu in a
  narrow window. New commands open the audit log and the message requests, and show or hide the
  pinned messages, the notifications and the member lists; the sidebar command opens the drawer
  in a narrow window.
- Settings > Agents shows an agent's runs: what it was handed and asked to do in a stretch of
  calls, with what the server recorded (`ExecuteCommandInput.runId`).
- Plugin commands can be approved per connected agent, one by one. A new optional manifest field
  `read_only` marks commands that run for it without asking; every other approved command asks
  first.
- A connected agent can ask to send a message to a channel it has a grant for: you see the whole
  text in a dialog and confirm each one.
- Settings > Bots creates and manages a workspace's bots, their tokens and channels, and incoming
  webhooks with a GitHub preset. Owners and Moderators see it on a server that has bots turned on,
  and the webhooks section on one that lists `incoming_webhooks`. A token or webhook URL is shown
  once. The command palette has "Open Bots".
- Bots are marked in messages and member lists, and show who runs them and where what they read
  goes, as the person who added them says. The marks and the statements need a workspace server
  that lists `bot_disclosure` in `serverInfo.capabilities`; on an older one nothing is marked,
  because it has no bots.
- Closing the desktop app's window now asks whether RIM stays running in the system tray or quits,
  and Settings > Desktop can set the answer. Everyone sees this once, the first time they close the
  window after updating. Ctrl+Q quits, after a confirmation.
- The desktop app can start when you sign in to the computer. It is off by default; turn it on in
  Settings > Desktop.
- The desktop app's tray icon shows a dot while you have unread notifications and offers "Restart
  to update" when an update is ready. Clicking a message notification opens that conversation.
- Settings > Agents lets a program on this computer, such as Claude Code, ask to connect to the desktop
  app. It is off by default. You compare a code and approve it, and you can disconnect it at any time.
- A Claude Code plugin in `integrations/claude-code` connects Claude Code to the desktop app: it shows the code to compare and adds RIM as an MCP server.
- A connected agent can read the channels you choose in Settings > Agents, from the messages on this device. It
  can't change anything, and it can't read encrypted conversations. "What it was given" shows what RIM handed over.

### Changed

- A plugin panel opens over the page you are on, such as Home, Unreads or Agent sessions,
  instead of switching to the conversation: a `tool_panel` panel is a narrow column at the left
  of the page and stays open when you go to another page, and a `main_area` panel takes the
  page's place until you close it or go to another page. A panel's `conversation.changed` is
  `null` while no conversation is shown, and a plugin command that needs a conversation says
  "Open a conversation first" on any other page.
- A command picked from the message box's `/` list with nothing typed after it does what the
  command palette does: it opens the palette's argument form, with the same fields and pickers
  (state keys with their values, members, conversations, emoji, times, "More options"), instead of
  leaving `key=value` to type. Typed `key=value` arguments still run; when they leave a required
  one out or give a value its field cannot take, the same form opens with them filled in.
- A pipeline action's arguments are fields for its command, with a picker where it has one, instead of a JSON box; a required argument the trigger cannot supply must be filled before Save, and saved arguments the fields cannot show are kept and can be removed.
- A plugin manifest listing `agents.connect_agent`, `agents.start_session`, `agents.stop_session`,
  `agents.ask_about_message`, `agents.ask_about_conversation` or `workspace.open_agent_sessions`
  in `runs_commands` is refused at install, and by the plugin SDK's `validateManifest`, like the
  other commands that answer and manage agents.
- The buttons of the rail, the top bar, the side panels, the conversation header and list, Home
  and Unreads run the same commands as the palette and keybinds, so a click does what the
  command does. Open Direct Messages from the palette or a key now leaves Home and Unreads, as
  the rail's button does.
- The buttons of Settings > Plugins, Bots and Agents and of a message request run their commands,
  as the palette does: Install from local folder and Install from git URL run Install Plugin,
  New bot and New webhook run theirs, a message request's Accept, Ignore, Block and Report run
  the message request commands, and an agent's Disconnect, Choose what it can read, Choose its
  commands, What it was given and Its runs run the agent commands for that agent. New webhook
  from the palette with no conversation open opens the form in Settings > Bots, and What Agents
  Were Given and Open Agent Runs can name one agent. The rows that revoke invites, answer join
  requests, unblock people, deactivate bots, revoke webhooks and take back a plugin's AI access do
  the same as their commands, with the same messages.
- The moderation dialogs (change role, time out, kick, ban, delete messages, slow mode, who can
  post), unban, clear timeout, the conversation menu, the notification mutes, joining, archiving
  and leaving channels, the members panel's invite and remove, and Mark all read run their
  commands, as the palette does: the audit log records a click as `ui` or `context_menu`, a
  click asks for the confirmation the palette asks for and only once, and a failure names the
  missing permission.
- A message's menu and reaction chips, the list's pin key, the pinned list's Unpin, the report
  dialog, a workspace's menu on the rail, Pause notifications and the Settings buttons for
  updates, the log folder, Back up now, shortcuts, macros, pipelines, status and signing out run
  the same commands as the palette: the same confirmation, and a refusal says why, such as the
  permission that is missing. Back up now and opening the log folder answer in a toast, and Set
  status opens the status dialog.
- A new logo: an R in three pieces held by an orange node, a wordmark with a lightning bolt for the I, new desktop, tray and browser icons, and a glowing bolt on the restoring-session screen.
- When an agent asks to run one of your macros, its confirmation, and an outside agent's card,
  list the macro's steps with the arguments fixed for each.
- `/macro <title>` and **Run Macro…** run your macros, found by title whatever the letter case;
  a workspace macro that moved into them still runs from a key or quick action that named it.
  Workspace macros of a workspace another server hosts are now read, run, changed and deleted on
  that server.
- Open Marketplace (Ctrl+Shift+X) is now Browse Plugins and opens Settings > Plugins, instead of a
  "coming soon" page. "Choose an Agent's Plugin Commands…" is now "Choose an Agent's Commands…".
- Commands are grouped by what they do (Navigation, Messages, Moderation, Home…) in the palette and in Settings > Keybinds, and keyboard shortcuts for the app's own commands, such as Toggle Zen Mode and Go Back, follow you to your other devices on servers that support it. Shortcuts you already set for them on this device move to the server once, with a short note; plugin shortcuts stay on this device.
- Commands that need more than the open conversation, such as Do Not Disturb, notification level and moderation actions, now ask for what they need in a form when run from the palette, a keybind or a quick box, instead of being left out. Settings > Keybinds can save a keybind's arguments, and Home's Quick actions settings take a command's arguments in the same fields instead of JSON; a field left empty is asked for when the command runs.
- The top bar's search field opens one search box: channels and people, messages and commands
  as you type, the open workspace or all of them (Tab), and Search all messages for the full
  search. Ctrl+K opens it with commands first, as the command palette. Back and Forward in the
  top bar move between the places you opened; bind them in Settings > Keybinds.
- One top bar holds search, plugins and notifications; the tool column is gone, and Settings and
  your account are at the bottom of the rail. Ctrl+B now hides the conversation list.
- The plugins menu, the palette and suggested keybinds show the marks hidden in plugin names and titles.
- Opening a conversation starts at your first unread message, from where the server says you
  stopped, and it only counts as read once you've reached the end of what's new. A setting keeps
  conversations unread until you mark them. It needs a workspace server that lists `read_marker`
  in `serverInfo.capabilities`; on an older one conversations open and count as read as before.
- Settings > Plugins groups plugins by how they run, and each opens in place with its
  permissions, settings and what agents can do with it.
- Settings > Agents shows each agent on one page: what it can read, what asks you first, what
  stays closed, and what it has been given. A token or webhook URL is shown in full, over
  several lines.
- The agent's run view and the confirmation dialog use the same cards: orange when you're needed, and a different card for each way a step can end.
- A refused command now shows a card that says which kind of refusal it was: not allowed, failed, or expired.
- The sign-in, sign-up and join screens are clearer: one main action on each, and the other ways in
  say when you'd use them.
- A new look: new colours and fonts across the app, with the fonts bundled so nothing is fetched
  from another host.
- A command the server refuses now says why: "not done" when you lack a permission, naming it, with
  no Retry; "failed" for a technical problem, with Retry only when repeating it is safe; and "expired"
  when a confirmation ran out, in neutral colours. A keybind whose command is refused now says so
  instead of doing nothing. The AI agent is told the same, so it does not retry a decision.
- Notifications now come from all your workspaces, not only the open one, following each
  workspace's notification settings. One from another workspace names it in its title and updates
  its badge on the rail. This needs a server that lists `notification_events` for workspaces on
  that server; on an older server only the open workspace notifies. A notification from a
  workspace on another server that waited over five minutes while you were away goes to the inbox
  without popping up.

### Removed

- Settings → Commands, where the server keeps your macros as your own commands: what it made
  are macros, in Settings → Macros, and the command that opened it opens Macros.

### Fixed

- A keybind or a Home quick action can now save arguments for commands that open a dialog, such
  as Create Channel, New Message, Invite Member, Reply, Edit and Report, in the same fields a macro
  step offers, and runs with them instead of opening the dialog; with none saved, the dialog opens
  as before. "Until tomorrow" in a macro step's mute now also ends at 09:00 tomorrow in your
  timezone, not the server's.
- In a workspace hosted on another server, the palette, keybinds, quick boxes, the message box,
  context menus and plugins now list and run that server's commands.
- Turning a keybind off or giving it other keys no longer drops the arguments saved with it.
- Muting a conversation until tomorrow from the palette, a keybind or a quick box ends at 9:00 on this device's clock, as the conversation menu does.
- Keybinds, quick boxes and the message box now run every command they offer, including ones that act on the selected message: Delete, Edit, Report, Reply, Copy Message Text and Open Thread work from a key on the message selected in the list, and say so when none is selected. The keybind and quick box pickers leave out commands that need arguments they cannot supply, and mark a saved one; the message box lists the app's own and the plugins' commands, and sends arguments typed after a command such as `/chat.create_channel name=ops` to it. Unreads, focus and the new Toggle Channel Lenses commands say where they work instead of doing nothing.
- Commands run from the message box now show their result, as they do from the palette; a command runs when picked from the open list, with the arguments typed after its name, and Esc sends the line as text.
- On a desktop with no tray, closing RIM asks what to do instead of hiding it with no way back.
- The built-in agent finds channels by name and no longer asks for ids.
- The confirmation dialog shows workspaces, channels and people by name, with their ids beside them,
  and names where a message will go when that isn't the conversation in view.
- The sign-up form says what's still missing when Create account can't be clicked.
- Sign-up has a way back to sign-in, every join page has a way out, emoji-led names no longer break
  a workspace's badge, and focus returns to the right place after closing dialogs in Settings > Bots.
- Installing a plugin from a local folder works on Linux.
- Starting the desktop app while it is already running brings the open window forward instead of
  starting a second copy on the same data.

### Security

- The desktop app's encrypted message cache uses a newer bundled SQLCipher: 4.20.0 on SQLite
  3.54.1 (rusqlite 0.42), which fixes CVE-2026-119375 (RUSTSEC-2026-0459, RUSTSEC-2026-0502).
  Existing caches open as before.

## [0.0.11] - 2026-11-03

### Fixed

- The Linux AppImage installs plugins from a Git URL and runs local plugins: the programs it
  starts (git, a plugin's process and its post-install steps) no longer load the AppImage's own
  libraries, which made git fail with "version `OPENSSL_3.5.0' not found".
- Installing a plugin from a Git URL no longer fails with "plugin already exists" when a folder
  of an earlier install is left in the plugins folder that Manage plugins does not list; the
  leftover moves to the trash and the plugin installs.

## [0.0.10] - 2026-11-03

### Added

- A timed-out member sees it at once: the composer locks with "You are timed out until 20:37:
  <reason>" when a moderator times them out, and unlocks when the timeout is cleared or ends,
  without a reload. The reason shows after a reload too. Needs a server that lists
  `member_timeout_changed`.
- A channel shows a line where an Owner or Moderator removed someone: "Bob was removed by
  Alice". Needs a server that lists `conversation_member_removals`.
- **Block…** in the person menu (right-click a name or avatar), the hover card, the profile card
  and a DM's menu, also for someone whose DM or group you already accepted. It asks first, then
  removes them from your contacts and hides your DMs with them and the groups they started until
  you unblock them in Settings → Direct messages.

### Changed

- After a block or an unblock the conversation lists refresh at once, and an open conversation
  the block hid closes. **Unblock** says that a conversation they started comes back as a request
  when they next write in it.

### Fixed

- A member removed from a workspace that is not open is told "You are no longer a member of
  <name>" and the workspace leaves the rail within a minute, or at once when they click it,
  instead of showing "Failed to load conversations." until a reload.
- While a dialog is open, such as Kick or Confirm: Run pipe, Ctrl+K and the other shortcuts do
  nothing, so no command runs behind it, and a confirmation that the command palette asks for
  closes the palette.
- Notifications of a group without a name are titled with its members' names, as in the sidebar,
  instead of "Someone and Someone".
- When part of the app cannot be downloaded (offline, or after the server's web app was updated),
  only the emoji picker or the Settings section that needed it says so, with Reload; the
  conversation, the composer and the list of Settings sections stay usable.
- Right-clicking a person's name, avatar or @mention closes their hover card, so it no longer
  covers the person menu, and no hover card opens while a menu is open.
- Moving through the composer's / suggestions with the arrow keys keeps the selected command in
  view, and the suggestions' descriptions are left-aligned.
- A workspace's menu on the rail, opened before its role loaded, fills in Browse channels…,
  Create channel…, Leave workspace… and the rest once it loads, instead of staying with Pause
  notifications and Assign keybind… only.
- "You were removed from <workspace>" and "You were banned from <workspace>" go away when you
  are a member of that workspace again.
- The profile card and the @mention card in a DM or group show no workspace role, instead of
  "Role: Guest" for people who are members of your workspaces.
- Error toasts close by themselves after 10 seconds, and stay while the pointer is on them.
  Toasts now sit at the bottom right above the composer, so they no longer cover buttons such
  as New Macro or Send.
- A pipe that asks for a confirmation says "Executing pipe" only after Run anyway, and not at
  all when the confirmation is cancelled.
- Settings → Keybinds says what saving keys another command holds does to it ("Ctrl+K is used by
  Open Command Palette. Saving moves it here and leaves Open Command Palette without a key."),
  and a command left without keys stays listed with No key and Set key.
- Use your recovery phrase, after too many wrong passwords, no longer sends a sign-in with an
  empty password.
- The Audit log shows each entry's sensitivity (Safe, Sensitive, Mutating, Restricted) and marks
  dangerous commands, and a pipe's entry is labelled Pipe instead of "—".

### Security

- The desktop app's openssl, serde_with and rand crates are updated past the versions GitHub's
  advisories list (openssl 0.10.82, serde_with 3.24, rand 0.8.8 and 0.9.5).

## [0.0.9] - 2026-10-31

### Added

- A message whose text is taller than about 16 lines shows its first lines with Show more, and
  Show less folds it again; in NAVIGATE, o does the same for the selected message. Long logs and
  text art no longer fill the timeline.
- Messages the server's automatic check flags (sexual text art) are covered with Show anyway;
  Owners and Moderators can Clear flag, and the check's reports show as Automatic check in
  Moderation, with the reported text covered the same way. Needs a server that lists
  `message_flag`; older servers work as before.
- Owners and Moderators can delete a person's messages in the workspace's channels from the last
  hour, 24 hours, 7 days or all of them: with Delete messages… in the person's menu or in
  Settings → Moderation → Bans, or while banning them. The dialog counts the messages first and
  lists private channels you are not in apart, so they can be left out. Needs a server that lists
  `delete_member_messages`; older servers work as before.
- Settings → About this server names the content checks among the server's features: Text art
  check and Profile picture check, each enabled, switched off, or not set up.

### Fixed

- The plugin guide explains optional desktop GitHub tokens and the visibility of private
  repository data in the Pull Requests and Releases plugins.
- With a message selected, Ctrl+C copies the text you highlighted instead of the whole message,
  and Ctrl, Alt or Cmd with a letter (Ctrl+R, Ctrl+P, …) no longer runs the timeline's reply, pin
  or other message keys.
- Clicking a message in the timeline selects it, also while NAVIGATE is on; before, the highlight
  stayed on the first message clicked.

## [0.0.8] - 2026-10-28

### Changed

- Cycle Recent Activity jumps to the conversations and threads where someone last posted, newest
  first; before it did the same as Next Conversation.

### Fixed

- Navigate to Channel, Navigate to DM, Switch Workspace and Join Channel in the command palette now
  ask which one to use; before, they did nothing, or joined the open channel. A keybind or macro
  that runs them with a `conversation_id` or `workspace_id` argument (or the camelCase spelling)
  keeps working.
- List Channels, List Members, Get Recent Messages and List State show their results in a
  window; before, only a count such as "2 channels found" appeared.
- Focus the Pane to the Left and Right now move the focus when run from the command palette.
  The palette no longer offers commands that cannot apply: List Channels, List State, Join
  Channel and Navigate to Channel in direct messages, Close Panel with no panel open, and Back
  to Workspace with nowhere to return to. Open Marketplace is marked as coming soon.
- Next and Previous Unread Conversation and Reopen Last Thread say so when there is nothing to
  go to, and Mark All as Read confirms when run from its keybind. Typing a command name in the
  palette no longer logs a highlight warning.

## [0.0.7] - 2026-10-28

### Added

- Messages in a workspace mark the author's role: a crown badge for owners, a shield badge for
  moderators and a Guest badge for guests. In direct messages the author's handle shows next to
  their name instead.

### Fixed

- The desktop app's sign-in, sign-up and join screens, and its error screen, now have the title
  bar with minimize, maximize and close, so the window can be moved and closed there.
- Typing right after opening a direct message from New message or a profile goes to that
  conversation: before, the first letters could land in the conversation you came from, and a
  quick Enter could post the message there unencrypted. A send while the conversation is still
  opening is refused with a notice and the text is kept, and text is never sent unencrypted into
  a conversation the server calls end-to-end encrypted.

## [0.0.6] - 2026-10-28

### Added

- Settings → Messages → **Clock** shows times on a 12-hour or 24-hour clock on this device;
  **Automatic** keeps following the browser's language.
- Settings → Direct messages lists the people you blocked under **Blocked people**, with
  **Unblock**. It needs rim-server with `myBlockedPrincipals`; with an older server the section
  says the server does not list blocked people yet.
- The audit log names who did each action and, for an action on a member, that member
  (**Alice → Carol**).
- **Reply** on a message (its menu, the reply arrow on hover, or <kbd>r</kbd>) quotes it above
  the composer; the message you send shows the quote, which jumps to the original. Works in
  encrypted conversations too.
- A DM or group started from a workspace shows **Back to \<workspace\>** in its header, and
  <kbd>Alt+←</kbd> does the same: back to that workspace and the conversation you left. The
  Mouse-friendly profile leaves <kbd>Alt+←</kbd> to the browser.
- An edited message shows **(edited)** after its text, in the timeline and the thread pane;
  hovering it shows when it was edited. With a server that reports edit times
  (`serverInfo.capabilities` lists `message_edited_at`) for every message; with an older server in
  encrypted conversations only.
- Groups in Direct messages offer **Add people…** in their menu and **Add people** in their
  members panel, listing your contacts and the people in your workspaces. It needs rim-server
  with `remoteMembers` on `addConversationMembers`; an older server refuses the addition with
  its own message.
- **Leave workspace…** in a workspace's menu on the rail and in the command palette, after a
  confirmation, for everyone but the Owner and not in the server's default workspace; and
  **Rename workspace…** for the Owner, there and in Settings → Workspace → **Name**. Every member
  sees a new name at once. Both need rim-server with `workspace_leave` and `workspace_rename` in
  `serverInfo.capabilities`; an older server does not show them.

### Changed

- **Upgrade:** update the server to rim-server 0.0.5 before the web client. With an older
  server, leaving and renaming a workspace are hidden, **Blocked people** says the server does
  not list them, an edited channel message shows no **(edited)**, and **Add people** on a group
  fails with the server's refusal.
- Conversations started by someone you blocked, including DMs and groups hosted on other
  servers, stay out of Direct messages, search, notifications and unread counts and are not synced
  until you unblock them; then they come back with their history. **Send message** to someone you
  blocked asks you to unblock them first, and the **Block** dialog says what blocking hides.
- **Block** on a message request asks first, says the person won't be told and where to unblock
  them, and confirms with a toast.
- Confirmation dialogs no longer show internal tags (MUTATING, DANGEROUS, OWNER, RESTRICTED) or
  the person's name in capitals; a dangerous action shows only as its red button.
- Channel and DM rows in the sidebar no longer show a grey member count, which read as an
  unread count; the conversation header still shows it.
- <kbd>r</kbd> on a selected message starts a reply instead of opening its thread; <kbd>t</kbd>
  opens the thread. The NAVIGATE bar offers <kbd>r</kbd>, <kbd>t</kbd> and <kbd>p</kbd> only
  where the conversation allows them.
- Importing a keyboard profile keeps the default shortcuts: the file's bindings take only the
  keys they name. **Replace all** in the import dialog uses the file alone, as before. A device
  on a built-in profile now gets shortcuts added in later versions.
- In the server's default workspace, **Invite people…** on a channel is offered only to its Owner
  and Moderators and to a private channel's creator, the people the server lets add members
  there.
- Settings → Security → Spaces through this relay no longer lists a workspace you left.
- **Unblock** in Settings → Direct messages says the person can message you again.

### Fixed

- After leaving an encrypted group, or blocking the sender of a group request, the app keeps
  syncing: before, every later sync failed on the group left, so encrypted conversations showed
  "[empty message]" or no messages, and new messages stopped arriving until the browser's data
  was cleared.
- **Block** on a message request for a DM no longer tries to leave the DM, which the server
  refuses; a group's request is still left.
- **Search Messages** in the command palette opens the search box instead of failing with
  ``missing string arg `query` ``.
- Search results and notifications show a mention as the person's name and the message as plain
  text, instead of a raw `<@…>` token or Markdown markers.
- A message without reactions no longer reserves an empty line under its text for the hover
  **Add reaction** button, which now sits beside **Open thread**; a thread's root shows its reply
  count right under the text.
- After **Sign out and remove from this device**, the sign-in page no longer offers **Sign in as …**
  for the removed account. Signing in to an account whose keys are not on this device says so and
  points to the recovery kit, instead of "this browser has no keys for that account", and no
  longer uses up a password try.
- Signing in no longer throws away the keys this device keeps for an account when they do not
  open: the sign-in stops, says the keys could not be opened, and leaves them as they were.
- In a command palette pipe, <kbd>Enter</kbd> on an empty search runs the chain instead of adding
  the highlighted command, such as **Ban Member**, as another stage; <kbd>Tab</kbd> or a click
  adds it. A confirmation is drawn in red and says so when the command, or a stage of the pipe,
  is dangerous.
- The command palette no longer lists commands that need an argument it cannot fill, such as
  **Kick Member**, **Set State** or **Do Not Disturb**, which always failed from there; a
  conversation's commands are listed while one is open.
- **Leave Conversation** and **Archive Channel** from the palette or a keybind ask first, with the
  conversation menu's confirmation.
- After `|` the palette offers only commands the server can run in a pipe, and a stage that runs
  only in the app is refused with "Pipe stage <n>: <title> runs only in this app, so it cannot be
  part of a pipe." instead of a "desktop-local" error.
- Errors read as one sentence instead of a dump of the server's response: creating a user command
  whose ID is taken, joining a workspace you are already in and other refusals no longer show the
  request, its variables or an invite token, and a lost connection says "Couldn't reach the
  server. Check your connection and try again."
- An invite link opened while signed out offers **Sign in as \<name\>** for the accounts this
  browser or computer holds keys for, or a **Sign in** link, and comes back to the invite; opened
  by a member it says "You're already a member of \<workspace\>." with **Open \<workspace\>**,
  and a revoked or expired link offers **Go to RIM** instead of a dead end.
- A reaction or topic change the server refuses says why in a toast, such as the 10 reactions one
  person can put on a message, instead of failing silently.
- Command palette success toasts show the command's result, such as "List Channels: 3 channels
  found.", instead of "— [object Object]"; toasts wrap to three lines with the full text on
  hover, and sit at the top right, clear of the composer's send button.
- The web app no longer offers the AI agent, which needs the desktop app: its palette command,
  Ctrl+Shift+A, the `/agent` suggestion and **Build with AI** are gone there, and opening it
  another way says "The AI agent is available in the desktop app." instead of failing
  silently.
- Macro steps and pipeline actions whose text is not a command id are marked
  "Unknown command: <id>" and are not saved; a failed macro shows the server's reason, and a
  pipeline firing says how many of its actions ran ("1 of 2 actions ran").
- The keybind recorder in Settings → Keybinds records keys that are already bound instead of
  running them, Escape cancels the recording instead of closing Settings, and keys in use show
  "Already used by <command> — saving will reassign it."
- Settings → Keybinds lists every default binding, including the app's own (Ctrl+D, Ctrl+L,
  Ctrl+Shift+Z, Ctrl+←/→, Shift+Alt+↑, `?`, Ctrl+/), and names contexts as Global, Composer,
  Message list and so on.
- A user command id takes only lowercase letters, numbers, dots, dashes and underscores, the
  step picker leaves out commands that need arguments a step cannot give, and the form no
  longer says "macro".
- An imported keyboard profile accepts modifiers in any case, such as `ctrl+j`.
- A line break typed with Shift+Enter shows in the sent message instead of running the
  lines together.
- Strikethrough, tables with their header row, horizontal rules and task-list boxes show in
  messages instead of disappearing; a wide table scrolls inside the message.
- A long word or link without spaces wraps inside the message instead of running off its edge.
- **New message** has a **Start conversation** or **Start group** button, so a DM or a group can be
  started with the mouse.
- The thread reply box offers the @mention list, emoji and **Attach file** like the main composer,
  and a member picked there is mentioned and notified.
- Confirmation dialogs show the confirm shortcut as Ctrl+↵ on Linux and Windows instead of ⌘↵.
- The conversation header says "1 member" instead of "1 members", for groups and DMs too.
- Notification previews show a message's text without HTML tags, table pipes, task boxes or
  rules, and a notification's reason stays on one line.
- Under **Email digest**, the notice no longer repeats the server's reason that email is not set
  up.
- An image in a message from another site shows as a link marked "image" instead of a broken
  image, and raw HTML in a message no longer makes the app load anything but the server's own
  files or log a security warning in the console.
- Custom emoji show as their images in messages, in the emoji picker and in Settings > Emoji, also
  in the desktop app; before, a message showed `:name:` as text.
- The NAVIGATE key hints no longer cover the newest message: the timeline makes room for them.
- At the bottom of a conversation, the timeline stays at the bottom while an image loads or a
  message gets its first reply, instead of leaving the new content under the composer.
- Escape and **Close Panel** close a plugin panel beside the conversation, the workspace members
  list, a conversation's members and the notifications list, and **Inbox** closes the members
  lists; **Close Panel** says when no panel is open.
- The first right-click on a message after opening a conversation opens its menu, and clicking
  into the timeline no longer scrolls it to the newest message.
- Search's operator suggestions sit between the search box and the results instead of covering
  the first result, and close once the value is typed in full.
- A thread opened on a message that arrived while you watched names its author instead of
  "Unknown user".
- The open workspace's menu on the rail lists **Join requests…** the first time it opens.
- A plugin panel's header shows the plugin's name, kind and source in full under the panel's
  title instead of cutting them off.
- After a recovery whose sign-in did not finish, the sign-in page offers **Sign in to your
  recovered account** instead of the raw account id.
- A request refused for going too fast says how many minutes to wait once the wait is a minute or
  more, instead of a count of seconds.
- **Create account** checks the username's rules before sending it, explains a refusal in a plain
  sentence under the field, shows the lowercase username it will save, and keeps the form as it
  was after a refusal, without **Discard keys**; while the recovery kit is shown the page says
  "Account created" and hides the invite code field.
- Signing up from a workspace invite on a server open to anyone joins the workspace as soon as the
  account exists, so closing the page at the recovery kit no longer leaves the account outside it.
- The avatar at the bottom of the side rail shows your profile picture.
- Your own presence dot shows you online, as others see you.
- During a new account's waiting period, Settings > Profile no longer says "Click to upload
  avatar", and a refused upload says when pictures open up instead of a count of minutes.
- A person banned from a workspace sees "You can't join" on its public link, with **Open RIM**,
  instead of "You can ask to join".
- The Invite member dialog says how many people can join with a link the same way before and
  after the link is generated.
- Reporting a message you already reported says so and closes, instead of offering **Retry**.
- The command palette names the app's own commands in Title Case like the rest (**New Message**,
  **Toggle Zen Mode**), lists each group alphabetically, and is announced as a dialog; the
  "Pipeline fired" toast says what set it off ("after a new message") instead of
  `(trigger: NewMessage)`.
- A group's member list no longer marks everyone, the workspace's Owner included, as Guest; an
  empty encrypted group says it is end-to-end encrypted.
- Typing `:` and the start of a name in the composer suggests from every emoji and from the
  workspace's custom emoji, not a short fixed list.
- A file over 25 MiB, or of a type the server does not take, is refused when you attach it, not
  when you send.
- A pipeline's conversation scope and its **In conversation** filter pick a channel by name
  instead of asking for its ID.
- Plugin details and activity name permissions as the permission prompt does (**Connect to
  listed sites**, not `network.fetch`); each plugin's on/off switch is a switch named after the
  plugin; in the web app, a plugin whose only settings are secret offers **Close** instead of
  **Save** and **Reset to defaults** that do nothing.
- The plugin docs say a GitHub release link installs in the web app too: the RIM server fetches
  it.
- Owners and Moderators find archived channels under **Archived** in **Browse channels**, so a
  channel archived without joining it can be opened and unarchived.
- Controls the server would refuse are no longer shown: a channel's topic can be edited only by
  its Owner and Moderators (and a private channel's creator), someone else's pipeline has no
  enable, edit or delete buttons for a Member, the default workspace offers creating channels to
  its Owner and Moderators only, and a guest gets no New entry, Edit or Delete for
  workspace-scoped state.
- While you read earlier messages, the timeline no longer jumps when a new message or image
  arrives or a message above is deleted; at the bottom, an arriving image no longer leaves the
  newest message partly out of view.
- A workspace on another server you were removed from, that was deleted, or that you left on
  another device, now leaves the rail.
- Your replies in a thread can be edited in the thread pane: **Edit message** in a reply's menu,
  or <kbd>e</kbd> in the pane, edits it in place as in the timeline. <kbd>Esc</kbd> in an edit
  form cancels the edit without closing the thread.
- Error toasts show a name the server quotes, such as an argument, as code instead of printing its
  backticks ("missing string arg text").
- A reaction with a custom emoji shows the emoji's image instead of its `:name:`; the name shows on
  hover.
- **(edited)** follows the message's text in the comfortable and compact layouts too, instead of
  sitting on its own line.
- The web app no longer lists Settings → **AI Agent** and **Plugin AI**, which only the desktop
  app's AI agent uses.
- When part of the app cannot be downloaded (a dropped connection), the app tries again, and if it
  still fails says "This part of the app could not load" with **Reload**, instead of a crashed
  conversation or Settings page whose Retry could not help.
- The command palette offers **Unarchive Channel** only in an archived channel and **Archive
  Channel** only in one that is not, instead of reporting success for a change that did nothing.
- When someone joins the workspace, the member count and members of its public channels update right
  away instead of after a reload.
- In a conversation's members panel, <kbd>Esc</kbd> in the invite picker closes only the picker (a
  second <kbd>Esc</kbd> closes the panel), and names use the row's width: **Leave**, **Remove** and
  the row's actions show when you point at or focus the row.
- A group's or DM's search button reads "Search in Bob and Carol" instead of "Search in #Bob and
  Carol", and the search box calls its scope "This conversation" instead of "Current channel".
- One <kbd>Esc</kbd> closes message search, as its footer says, instead of first clearing the query.
- The "This conversation is not encrypted" dialog opens by itself once per conversation on a device
  instead of in every browser session; while the account is locked it waits, and **Not encrypted**
  in the header opens it.
- The command palette no longer toasts "Executed locally" after a command that opens something in
  the app, such as **Search Messages** or **Open Settings**; **Mark All as Read** and **Reload
  Commands** say what they did.
- Times on a 12-hour clock read "9:15 PM" instead of "09:15 PM".
- The four conversation navigation commands are named alike: **Previous Conversation**, **Next
  Conversation**, **Previous Unread Conversation** and **Next Unread Conversation**; they go through
  DMs and groups as well as channels.

## [0.0.5] - 2026-10-26

### Fixed

- The app no longer fails with "The app hit a render error" (`… .default is not a function`) in
  release builds: the command palette's search takes microfuzz's `createFuzzySearch` however the
  bundle exposes the CommonJS package.

## [0.0.4] - 2026-10-26

### Added

- A thread's root shows how many replies it has (**3 replies**) under it, kept current as
  replies arrive or are deleted. It needs rim-server with `Message.threadReplyCount`; with an
  older server the root shows **View thread** as before.

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
- The conversation header no longer shows a channel icon before "No conversation".
- The NAVIGATE key hints show in full above the composer instead of behind it.
- Focusing the thread's reply box switches the status bar to COMPOSE and hides the NAVIGATE
  hints, as the main composer does.
- The command palette puts the best match first: a title match above a description or category
  match, a word start above scattered letters, with groups ordered by their best match.
- Ctrl+Shift+G is listed as **New message** in the palette, Settings → Keybinds and the
  shortcuts sheet, matching what it opens.
- The thread pane shows a mention in the root message and in the replies as the person's name,
  as the timeline does, instead of the raw `<@…>` token.
- A message with a thread keeps **Open thread** in its hover actions and shows **View thread**
  under it in every density. Before, a small "thread" link by the time showed only on the first
  message of a group.

### Security

- Turning a plugin on with its switch in Settings → Plugins first asks, in **Plugin
  Permissions** with **Approve and turn on**, for the permissions it has not been granted;
  before, it started without asking.
- A plugin's panels show only when it holds **Render UI Panels** (`ui.panel`): the Plugins
  menu, the palette's **Open \<panel\>** commands and a panel left open no longer show one
  without it, on the web and the desktop.

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

[Unreleased]: https://github.com/rim-platform/rim-ui/compare/v0.0.13...HEAD
[0.0.13]: https://github.com/rim-platform/rim-ui/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/rim-platform/rim-ui/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/rim-platform/rim-ui/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/rim-platform/rim-ui/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/rim-platform/rim-ui/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/rim-platform/rim-ui/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/rim-platform/rim-ui/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/rim-platform/rim-ui/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/rim-platform/rim-ui/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/rim-platform/rim-ui/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/rim-platform/rim-ui/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/rim-platform/rim-ui/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rim-platform/rim-ui/releases/tag/v0.0.1
