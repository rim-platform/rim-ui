# Commands and automation

Everything RIM does runs as a command: the command palette, keybinds, user commands, macros,
pipelines, plugins and the AI agent all run them. This page is for the person using the app and
goes deeper than [Getting started](getting-started.md). The contract behind it is rim-server's
[command model](../../rim-server/docs/command_model.md).

## What a command is

A command is one named action with a stable id, such as `chat.create_channel` or
`workspace.open_search`. No surface has actions of its own: a keybind names a command, a macro
is a list of commands, a pipeline runs commands when something happens. Commands come from
three places:

- **Built in.** Shipped with RIM. Most run on the server, such as posting a message or setting a
  slow mode; the ones that only move around the app, such as opening search, run in the app.
- **Your own.** User commands and macros, each a sequence of other commands, kept on the server
  for your account.
- **Plugins.** Each turned-on plugin adds commands that run on this device, inside the plugin
  ([Plugins](plugins.md)).

**Arguments and context.** A command takes typed arguments, such as a conversation, a user or a
piece of text. Context is where you are when it runs: the open workspace, the open conversation,
a selected message. A command whose workspace or conversation argument is empty takes it from the
context. The palette, keybinds and the composer's `/` list send the open workspace; a message's
context menu adds the conversation and the message, and the AI agent the open conversation. A
server command that needs a conversation therefore runs from a context menu, from the agent, or
with the conversation's id in its arguments. A plugin command that needs a conversation gets the
open one; with none open, the palette leaves it out and its keybind says "Open a conversation
first".

**Sensitivity.** Every command has one of four tiers, and the server decides from it whether a
run waits for your confirmation:

| Tier | What it covers | You run it | The agent or a pipeline runs it |
|---|---|---|---|
| Safe | Reads, searches and moving around the app | Runs | Runs |
| Sensitive | Low-impact changes the audit log records | Runs | Runs |
| Mutating | Posting, creating a channel, reacting, workspace state, notification settings | Runs | Needs your confirmation |
| Restricted | High-impact changes, such as deleting a message | Asks, and you type its verb | Needs your confirmation |

A command can also be marked dangerous, such as kicking, banning or changing someone's role. It
always asks first, whoever runs it, and the palette tags it **dangerous**. The confirmation
dialog reads "Confirm:" and the command's title, lists the arguments, and offers **Cancel** and
a button that follows the tier: **Run anyway** for a mutating command, **I understand —
execute** for a restricted one, **Confirm** otherwise. A restricted command first asks you to
type its verb, as in `Type "delete" to confirm`. A confirmation expires; the app then says
"Confirmation expired. Run the command again."

**Capabilities.** A command declares what it needs, such as `chat.write` or
`admin.manage_members`, and the server lists only the commands your role in the workspace may
run; a plugin's command acts only within the permissions you granted the plugin.

## The command palette

<kbd>Ctrl+K</kbd> opens the palette, and so does <kbd>:</kbd> in Vim normal mode. "Type a
command..." searches the title, description and category of every command, fuzzily, with the
matched letters highlighted. The arrow keys move, <kbd>Enter</kbd> runs, <kbd>Esc</kbd> closes.

The list is grouped by category, in alphabetical order: the built-in Admin, Chat, Notifications,
State and Workspace; User, for your user commands; one per turned-on plugin, under its name, with
an "Open \<panel\>" command for each panel of a running plugin; and Workspace plugins, the
registry's plugins this device has not installed, as "Install \<name\>"
([Workspace registry](plugins.md#workspace-registry)).

Each row shows where the command comes from (built in, plugin or yours), its category and its
keybind. Left out are a plugin command that needs arguments, which its plugin's panel runs, a
plugin command that needs a conversation while none is open, and macros, which run from
Settings → Macros or `/macro`. Running a command closes the palette at once; a toast gives its
title on success or "\<title\>: \<message\>" on failure, and a plugin command answers in its words.

**Pipes.** Typing <kbd>|</kbd> locks the text before it as a stage: a command id, optionally
followed by `key=value` arguments with no spaces in the values. Pick the last command from the
list, or press <kbd>Enter</kbd> on an empty search to run the chain. Each stage's result is
merged into the next stage's arguments. A chain has at most 10 stages, all of them commands the
server runs. The palette then shows each stage's result, or "Pipe failed at stage \<n\>: …".
<kbd>Backspace</kbd> in an empty search reopens the last stage, and <kbd>Esc</kbd> clears the
chain.

## Keybinds

A keybind runs one command, sometimes with fixed arguments. These are the default bindings of a
new device:

| Keys | Command |
|---|---|
| <kbd>Ctrl+K</kbd> | Open the command palette |
| <kbd>Ctrl+Alt+S</kbd> | Open Settings |
| <kbd>Ctrl+F</kbd> | Search in this conversation |
| <kbd>Ctrl+Shift+F</kbd> | Search the workspace |
| <kbd>Ctrl+Shift+X</kbd> | Open the plugin marketplace |
| <kbd>Ctrl+Shift+A</kbd> | Open the AI agent |
| <kbd>Ctrl+Shift+C</kbd> | Create a channel |
| <kbd>Ctrl+Shift+G</kbd> | New message |
| <kbd>Ctrl+Shift+M</kbd> | Mark everything as read |
| <kbd>Ctrl+Shift+K</kbd> | Jump to a conversation; with none named, opens the palette |
| <kbd>Ctrl+Shift+T</kbd> | Reopen the last thread |
| <kbd>Ctrl+R</kbd> | Cycle recent activity: the next conversation, wrapping around |
| <kbd>Ctrl+B</kbd> | Toggle the sidebar |
| <kbd>Ctrl+E</kbd> | Focus the composer |
| <kbd>Ctrl+D</kbd> | Cycle display density |
| <kbd>Ctrl+L</kbd> | Cycle layout preset |
| <kbd>Ctrl+Shift+Z</kbd> | Toggle Zen mode |
| <kbd>Alt+ArrowUp</kbd>, <kbd>Alt+ArrowDown</kbd> | Previous or next conversation |
| <kbd>Shift+Alt+ArrowUp</kbd>, <kbd>Shift+Alt+ArrowDown</kbd> | Previous or next unread conversation |
| <kbd>Ctrl+ArrowLeft</kbd>, <kbd>Ctrl+ArrowRight</kbd> | Focus the pane to the left or right |
| <kbd>Escape</kbd> | Close the open plugin panel, thread or Settings page |
| <kbd>?</kbd>, <kbd>Ctrl+/</kbd> | Show keyboard shortcuts |

On a Mac, <kbd>Cmd</kbd> works wherever <kbd>Ctrl</kbd> is written. The timeline's own message
keys, such as <kbd>r</kbd> for a thread and <kbd>e</kbd> to edit, are in [Keyboard](keyboard.md).

**Contexts.** A binding belongs to a context: Global (everywhere), Composer, Message list,
Thread view, Conversation view, Panel (the rails, the tool panel and plugin panels) or Command
palette. It works where its context has focus; a global one works everywhere. In a text field,
keys that type a character and the editing chords stay with the field, unless a binding is made
for that very context.

**Settings → Keybinds** lists the server's defaults, your bindings and this device's, grouped
into Navigation, Chat, Panels, Agent, Plugins and Other, with "Search keybinds..." above them.

- **Add keybind** opens a form: press the keys in "Press a key combination...", pick the
  command and the context, then **Save**.
- On a binding of your own, the pencil changes its command or context, clicking the keys records
  new ones, the switch turns it off, and the bin deletes it after "Delete keybind?".
- The default rows carry the **Default** tag and cannot be edited, turned off or deleted here.
  A binding of yours on the same keys and context takes their place: **Override** opens the add
  form with the default's keys, command and context filled in, ready to change and save. A
  profile can free a key altogether.
- A second binding of yours on the same keys and context is refused with "keybind already exists
  for this scope/context/keystroke". You can have up to 200.
- Bindings to plugin commands, to "Open \<panel\>" commands and to the app's own commands, such
  as Zen mode or the Vim switch, stay on this device and carry the **This device** tag. The rest
  are kept on the server and follow you to every device.
- On the desktop, **Plugin Suggestions** lists the keys turned-on plugins suggest that are not
  bound yet; **Assign** binds one on this device.

**A shortcut to a place.** Hover a conversation in the list or a workspace in the rail, press
<kbd>Ctrl+Shift+B</kbd>, then the keys. The app binds them to jump there and says "Shortcut
\<keys\> assigned to \<name\>".

**Layers.** One key resolves through layers, highest first: this device's bindings, yours and the
workspace's from the server, the active profile, then the server's defaults. A key a higher layer
holds is gone from the layers below, even while that binding is off. Workspace bindings are set
by the workspace's Owner through the API; Settings has no form for them.
[Where a key goes](keyboard.md#where-a-key-goes) has the details.

**Profiles.** Settings → Keyboard picks the device's profile: Minimal, the plain defaults a new
device starts with; Vim, the same with Vim mode on; or Mouse-friendly, which leaves Ctrl+R, B, E,
D, L, Ctrl+Shift+Z and the Ctrl arrows to the browser and the text field. **Export profile** and
**Import profile** share one ([Keybind profiles](keyboard.md#keybind-profiles)).

**Vim mode.** The **Vim mode** switch in Settings → Keyboard, or the "Toggle Vim mode" command,
adds a modal layer: <kbd>h</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>l</kbd> move in normal mode, and
a text field is insert mode ([Vim mode](keyboard.md#vim-mode)).

**The shortcuts panel.** <kbd>?</kbd> outside a text field, <kbd>Ctrl+/</kbd>, or **Show
shortcuts** in Settings → Keyboard opens "Keyboard shortcuts". It lists every binding in force,
grouped by context, with "Vim normal mode" while Vim is on, and "Filter shortcuts..." narrows it.

## User commands and macros

Both run a sequence of commands as one, and both are yours alone: nobody else in the workspace
sees or runs them.

**User commands** appear in the palette and can be bound to keys. Settings → Commands, **New
command**, asks for a **Command ID** (saved as `user.<id>`), a **Title**, a **Description** and
the **Steps**: **+ Add step** picks a command the server runs, and the arrows reorder. **Create**
saves it. Its steps take no arguments here, so each one uses the context. A user command can be
bound when all its steps can, is dangerous when one step is, and can include other user
commands, eight levels deep at most. Editing one, with the pencil, asks for its steps again,
since the saved ones cannot be loaded back into the form: **Save** stays off until a step is
chosen, and the new steps replace the old.

**Macros** carry arguments for each step. Settings → Macros, **New Macro**, opens "Create
Macro": a **Name**, a **Description** and up to 20 **Steps**. Each step has a command, found with
"Search commands...", and an arguments field that takes JSON, such as
`{"conversation_id": "…", "text": "…"}`. The search leaves out commands that only run in the app,
and a step typed as one is marked as failing. **Save** stores it. On the desktop, **Build with
AI** turns a description into steps with the provider set in Settings → AI Agent: **Generate**,
check the preview, then **Use these steps** opens them in the editor.

A macro runs from the play button on its row ("Run macro"), or from the composer: send
`/macro <name>` ("Run Macro"). It runs on the server, step by step, with the open workspace as
its only context:

- **Steps do not pipe.** Each step gets its own arguments; a step that needs a conversation names
  it with `conversation_id`. A command that only runs in the app fails as a step.
- **Confirmation.** A macro with a restricted step asks once, before any step runs, in
  `Run macro "<name>"`: "This macro includes commands marked as dangerous. They may delete data
  or make irreversible changes." A dangerous step below the restricted tier, such as kicking a
  member, cannot be confirmed inside a macro, and the macro stops there.
- **A failing step** stops the macro. The steps before it stay done, and the toast says
  "Macro failed: macro \`\<name\>\` failed on a step". A macro that finishes says
  `Macro "<name>" executed`.
- **Limits.** A macro cannot contain another macro, and its name has at most 128 characters. You
  can keep 50 macros per workspace, and the page shows the server's own cap when it sets one.

Two macros, as examples:

- **Standup.** `chat.post_message` with `{"conversation_id": "<#standup's id>", "text": "Standup:
  yesterday, today, blockers?"}`, then `state.incr` with `{"key": "standup.count"}`, which
  counts the standups in workspace state.
- **Heads down.** `notifications.mark_all_read` with no arguments, then `notifications.dnd` with
  `{"mode": "until", "minutes": "120"}`, which pauses your notifications for two hours.

## Pipelines

A pipeline runs commands on the server when something happens in the workspace: a trigger, up
to five filters that must all match, and up to ten actions, each a command with arguments. It
runs them as the person who created it.

- **Triggers**: New Message, Message Updated, Message Deleted, Reactions Updated, Member Joined
  and Workspace State Changed. "Scope to conversation ID (optional)" limits the first four to
  one conversation.
- **Filters**: "Message contains pattern", a case-sensitive text match; "Message from user", by
  user id; "In conversation", by conversation id. A text filter never matches a message in an
  end-to-end encrypted DM or group, which the server cannot read.
- **Actions** get the workspace as context, and the conversation for message and reaction
  triggers. Each action runs even when an earlier one failed.

**Where.** Settings → Pipelines, which is not shown in Direct messages. **New Pipeline** opens
"Create Pipeline" with **Name**, **Description**, **Trigger**, **Filters** (**Add filter**),
**Actions** (**Add action**, a command and an optional JSON arguments field) and **Cooldown
(seconds, optional)**, then **Save**. The list shows each pipeline as Active or Disabled, with
its trigger, its number of actions and, to its creator, when it last fired. The power button
enables or disables it, the pencil edits it, and the bin deletes it after a confirmation.

**Who.** Any member of the workspace can create a pipeline, and every member sees the list. Only
its creator, an Owner or a Moderator can change, toggle or delete it.

**What runs.** Nobody is there to confirm, so the server skips any action that would need a
confirmation: every mutating, restricted or dangerous command, which includes posting a message,
reacting and writing workspace state. Safe and sensitive server commands run. The editor's
command search offers only these, and says why above the actions; an action set to a command the
pipeline would skip, or to one that only runs in the app, is marked. A pipeline reacts
only to events its creator may see: a message in a private channel its creator is not in fires
nothing. On every firing, its creator, with the workspace open, sees "Pipeline "\<name\>"
fired", with the number of actions that ran; skipped actions are not counted.

**Limits.** The cooldown stops a pipeline from firing again until it has passed. A pipeline that
fires more than 10 times in 60 seconds is switched off, with "Pipeline "\<name\>" suspended";
the power button turns it back on. You can create 50 pipelines per workspace, and the page shows
the server's own cap when it sets one.

**Example.** "Deploy failed": trigger New Message, scoped to the id of #deploys, with the filter
"Message contains pattern" `FAILED`, a cooldown of 300 and the action `chat.search_messages`
with `{"query": "FAILED"}`. Each failure posted to #deploys shows the pipeline's creator the
firing, at most once in five minutes. The action's result is not shown anywhere, and an action
such as `chat.post_message` would be skipped.

## Workspace state

Workspace state is a key-value store the server keeps for each workspace. Commands, macros and
the agent use it through `state.get`, `state.list`, `state.set`, `state.incr` and `state.delete`,
and a pipeline can react when it changes. Plugins have no access to it. An entry belongs to one
of two scopes: the workspace's, which every member reads and writes, or your own, which only you
see.

Settings → State shows it, outside Direct messages. **Server** and **User** switch between the
workspace's scope and yours, and "Filter by prefix..." narrows the list. **New entry** asks for a
**Key**, a **Value (JSON)** and a **TTL (minutes, optional)**, then **Create**; each entry can be
edited and deleted, and shows when it expires.

- A key starts with a lowercase letter, uses `a-z`, `0-9`, `.`, `_`, `:` and `-`, and ends with
  a letter or digit. Keys starting with `system.` belong to the server.
- A value has at most 64 KB and lives at most 30 days when it has a TTL. The workspace's scope
  holds 10,000 entries and yours 1,000.
- Anything that reads a scope sees its values, the AI agent and its model provider included. Do
  not keep secrets there.

## The AI agent

On the desktop, the AI agent (<kbd>Ctrl+Shift+A</kbd>, or `/agent` in the composer) works
through the same commands and the same gates as you do. It sees only commands marked callable by
an AI: a reviewed set of built-ins and the plugin commands you approved in Settings → Plugin AI,
and no user command or macro made in Settings. A call that changes anything waits for you in the
confirmation dialog, headed "Agent wants to:", and the agent runs at most three such actions per
run. Settings → AI Agent sets its provider and key, and
[Using a plugin](plugins.md#using-a-plugin) covers approving a plugin's commands for it. A
server's operator can turn its access off.

## Next

- [Keyboard](keyboard.md): how a key is resolved, the profile file and the Vim layer in full.
- [Plugins](plugins.md): installing, trusting and using plugins and their commands.
- [Command model](../../rim-server/docs/command_model.md): rim-server's contract for commands,
  sensitivity, confirmations, macros and what the agent may call.
