# Commands and automation

Everything RIM does runs as a command: the command palette, keybinds, macros, pipelines,
plugins and the AI agent all run them. This page is for the person using the app and
goes deeper than [Getting started](getting-started.md). The contract behind it is rim-server's
[command model](../../rim-server/docs/command_model.md).

## What a command is

A command is one named action with a stable id, such as `chat.create_channel` or
`workspace.open_search`. No surface has actions of its own: a keybind names a command, a macro
is a list of commands, a pipeline runs commands when something happens. Commands come from
three places:

- **Built in.** Shipped with RIM. Most run on the server, such as posting a message or setting a
  slow mode; the ones that only move around the app, such as opening search, run in the app.
- **Your own.** Macros, each a sequence of other commands, kept on your home server for your
  account ([Macros](#macros)).
- **Plugins.** Each turned-on plugin adds commands that run on this device, inside the plugin
  ([Plugins](plugins.md)).

**Arguments and context.** A command takes typed arguments, such as a conversation, a user or a
piece of text. Context is where you are when it runs: the open workspace, the open conversation,
a selected message. A command whose workspace or conversation argument is empty takes it from the
context; one given in its arguments, such as a keybind's preset arguments, wins. The palette,
keybinds, the composer's `/` list, a macro run and the AI agent send the open workspace, the open
conversation and the thread open beside it; a message's context menu sends the message's
conversation, its thread and the message instead. A server command that needs a conversation,
such as marking it read or setting its notification level, therefore acts on the open one, and
with none open it needs the conversation's id in its arguments. A plugin command that needs a
conversation gets the open one; with none open, the palette leaves it out and its keybind says
"Open a conversation first".

**The argument form.** A server command run from the palette, a keybind or a Home quick action
that lacks a required argument opens a form titled with the command, with a field for each missing
argument: a text field, a number field, a checkbox, a list of the allowed values, a search of the
workspace's members, a list of its conversations or a list of your workspaces, each labelled with
the argument's title, its description beneath and its default filled in. The first field has the
focus, <kbd>Tab</kbd> moves between fields, <kbd>Enter</kbd> runs the command, and
<kbd>Escape</kbd> or **Cancel** runs nothing. A dangerous command still asks for confirmation after
the form. A message, a thread or selected text is never asked for: without one the command says
"Select a message first" (or "Open a thread first", "Select some text first"). Pipes, plugin panels
and agents get no form; they name the missing argument, as the message box does.

**From the message box.** The suggestion list decides: a command runs only when it is picked from
the open list, with Enter or Tab on the highlighted row or a click. Type `/` and the words of a
command's id or title (`/list members`, `/List Members`, `/chat.list_members`): the list stays open
across spaces, the first match is highlighted, and Enter runs it. Esc closes the list and keeps it
closed for that line, until the line is emptied or the conversation changes; Enter then sends the
text as an ordinary message, `/list members` included. Text that matches no command shows no list
and is sent as a message as well.

Arguments follow the name as `key=value` pairs, with a value that has spaces in double quotes:
`/chat.post_message text="two words"`. The command stays listed while you type them, and Enter runs
it with them. Picking a command that needs arguments leaves `/admin.kick ` to finish, keeps the list
open and shows what the command needs in its row; Enter on a line that still lacks one says which
and gives the form to type, and sends nothing. A thread's reply box has the same list and rule.
A command that carries a message's text (`chat.post_message`, `chat.edit_message`, and any command
with a `text` argument) refuses to run for an end-to-end encrypted conversation, so that text never
reaches the server in plain; text sent after Esc goes through normal encrypted sending.
`chat.mark_as_unread` needs a `message_id=`, and `chat.reply_to_selected_message`, which acts on a
selected message the box cannot have, is not listed.

A pipe (`/a | b`) has no list: a line with `|` that starts with a known command runs as a pipe on
Enter, and after Esc, or in a thread, it is sent as text. The server reads a pipe's arguments
without quotes.

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
dialog reads "Confirm:" and the command's title, is drawn in red for a dangerous command and says
so, lists the arguments, and offers **Cancel** and a button that follows the tier: **Run
anyway** for a mutating command, **I understand — execute** for a restricted one, **Confirm**
otherwise. A restricted command first asks you to type its verb, as in `Type "delete" to
confirm`. A confirmation expires; the app then says "Confirmation expired. Run the command
again."

The **Audit log** shows each entry's sensitivity, marks dangerous commands with a warning sign,
and labels a pipe's entry **Pipe**; a pipe is recorded with the strictest sensitivity of its
stages.

**Capabilities.** A command declares what it needs, such as `chat.write` or
`admin.manage_members`, and the server lists only the commands your role in the workspace may
run; a plugin's command acts only within the permissions you granted the plugin.

## The command palette

The palette is the search box under the top bar with commands first. <kbd>Ctrl+K</kbd> opens it
so, and so does <kbd>:</kbd> in Vim normal mode; in a box opened with search first,
<kbd>Ctrl+K</kbd> or typing <kbd>&gt;</kbd> switches to commands, and <kbd>Backspace</kbd> in an
empty field switches back ([Search UI](search-ui.md#the-search-box)). "Type a
command..." searches the title, description and category of every command, with the matched
letters highlighted. The best match comes first: a match in the title ranks above one in the
description or category, and a whole word or the start of one above letters inside a word or
scattered through it; in a description or category only a match that starts at a word counts.
The arrow keys move, <kbd>Enter</kbd> runs, <kbd>Esc</kbd> closes.

Without a search the list is grouped by category, in alphabetical order: the built-in Admin,
Chat, Notifications, State and Workspace; Macro, for your macros; one per turned-on plugin,
under its name, with an "Open \<panel\>" command for each panel of a running plugin; and
Workspace plugins, the registry's plugins this device has not installed, as "Install \<name\>"
([Workspace registry](plugins.md#workspace-registry)). With one, the groups follow their best
match.

Each row shows where the command comes from (built in, plugin or yours), its category and its
keybind. A command that needs an argument nothing around it fills, such as **Kick Member** (the
member), **Do Not Disturb** (the mode) or **Mark as Read** with no conversation open, is listed and
asks for it when run (see "The argument form" below). Left out are a command that needs a selected
message, which the palette never has, such as **Pin Message**; a plugin command that needs arguments, which its plugin's
panel runs, or a conversation while none is open; **Archive Channel** outside a channel that is not
archived and **Unarchive Channel** outside an archived one. **Leave Conversation** and **Archive Channel** ask first, as the conversation's menu
does: "Archive \<channel\>?" always, "Leave \<name\>?" for a group or a private channel; a
public channel, which you can join again, is left at once. Running a command closes the palette
at once; a toast gives its title and the result's message on success, such as "List Channels: 3
channels found.", except for a command that opens or moves something in the app, which shows
that instead, or "\<title\>: \<message\>" on failure, and a plugin command answers in its
words.
**Search Messages** run from the palette or a keybind without a `query` opens the full message
search, as **Search all messages** in the search box does; with a `query`, such as a keybind's preset argument, or as a pipe stage,
the server runs the search.

**Pipes.** Typing <kbd>|</kbd> locks the text before it as a stage: a command id, optionally
followed by `key=value` arguments with no spaces in the values. The list then offers only the
commands that can be the next stage: those the server runs whose arguments come from where you
are. <kbd>Enter</kbd> on an empty search runs the chain; with a search, <kbd>Enter</kbd> adds the
highlighted command as the last stage and runs the chain, and <kbd>Tab</kbd> or a click does the
same. Each stage's result is merged into the next stage's arguments. A chain has at most 10
stages, all of them commands the server runs. A stage that runs only in the app stops the chain
before it is sent: "Pipe stage \<n\>: \<title\> runs only in this app, so it cannot be part of a
pipe." When a stage is dangerous, the confirmation ("Confirm: Run pipe") is drawn in red and
names it: "Includes a dangerous command: \<title\>." While the chain runs, "Executing pipe: stage
1/\<n\>..." shows; a chain that asks for a confirmation shows it only after **Run anyway**. The
palette then shows each stage's result, or "Pipe failed at stage \<n\>: …". <kbd>Backspace</kbd>
in an empty search reopens the last stage, and <kbd>Esc</kbd> clears the chain.

## Buttons and menus run commands

A button, a menu item, a dialog's main button or a key in a list that does what a command does
runs that command, the way the palette runs it: the same lookup, gates, result and audit entry.
The audit log records where it started: `ui` for a button, a toggle, a dialog's main button or a
Home quick box (a server that does not list `command_initiator_ui` records these as `palette`),
`context_menu` for an item of a menu, such as a conversation's, a person's or a notification's,
and `keybind` for a key in a list. A control acts on what it shows: a sidebar
row's menu on that row's conversation, a person's menu on that person, a notification's menu on
its conversation, never on whatever happens to be open.

A click asks for the same confirmation the palette asks for: **Archive Channel…** and **Leave
channel…** in a conversation's menu ask "Archive \<channel\>?" or "Leave \<name\>?", as the
palette does, and only once. A control with its own confirmation, such as the Kick, Ban, Change
role, Time out and Delete messages dialogs or a member row's **Remove**, is that confirmation:
nothing asks again, except for a `Restricted` command, which still asks you to type its verb. A
refusal reads as it does from the palette, naming a missing permission; a dialog shows it in
place, with **Retry**. The command's gates apply too: while you are timed out you cannot join a
channel, kick, ban or set slow mode from a click either. Where a server does not list the command
yet, such as **Clear Timeout**, **Mute Conversation…**, **Unmute Conversation** or **Edit
Topic…** on an older server, the control does what it did before.

## Keybinds

A keybind runs one command, sometimes with fixed arguments. These are the default bindings of a
new device:

| Keys | Command |
|---|---|
| <kbd>Ctrl+K</kbd> | Open the command palette |
| <kbd>Ctrl+Alt+S</kbd> | Open Settings |
| <kbd>Ctrl+F</kbd> | Search in this conversation |
| <kbd>Ctrl+Shift+F</kbd> | Search the workspace |
| <kbd>Ctrl+Shift+X</kbd> | Browse plugins: Settings > Plugins |
| <kbd>Ctrl+Shift+A</kbd> | Open the AI agent (desktop app) |
| <kbd>Ctrl+Shift+C</kbd> | Create a channel |
| <kbd>Ctrl+Shift+G</kbd> | New message |
| <kbd>Ctrl+Shift+M</kbd> | Mark everything as read, with an Undo for 6 seconds before the server is told |
| <kbd>Ctrl+Shift+K</kbd> | Jump to a conversation; with none named, opens the palette |
| <kbd>Ctrl+Shift+T</kbd> | Reopen the last thread |
| <kbd>Ctrl+R</kbd> | Cycle recent activity: jump to where someone last posted, newest first; pressed again within 5 seconds it goes further back |
| <kbd>Ctrl+B</kbd> | Hide or show the conversation list |
| <kbd>Ctrl+E</kbd> | Focus the composer |
| <kbd>Ctrl+D</kbd> | Cycle display density |
| <kbd>Ctrl+L</kbd> | Cycle layout preset |
| <kbd>Ctrl+Shift+Z</kbd> | Toggle Zen mode |
| <kbd>Alt+ArrowUp</kbd>, <kbd>Alt+ArrowDown</kbd> | Previous or next conversation |
| <kbd>Shift+Alt+ArrowUp</kbd>, <kbd>Shift+Alt+ArrowDown</kbd> | Previous or next unread conversation |
| <kbd>Alt+ArrowLeft</kbd> | Back to the workspace and conversation a DM or group was opened from |
| <kbd>Ctrl+ArrowLeft</kbd>, <kbd>Ctrl+ArrowRight</kbd> | Focus the pane to the left or right |
| <kbd>Escape</kbd> | Close the open panel: a plugin panel, the thread, a page such as Settings, or the notifications or a members list in the tool panel |
| <kbd>?</kbd>, <kbd>Ctrl+/</kbd> | Show keyboard shortcuts |

On the Unreads page, while the focus is on the page, <kbd>J</kbd> and <kbd>K</kbd> move through the messages, <kbd>E</kbd> marks the selected conversation read up to the newest message shown, <kbd>Enter</kbd> opens the selected message and <kbd>U</kbd> takes back the last mark, for 10 seconds. These keys belong to the page and stay what they are. Each runs a command (`workspace.unreads_next`, `workspace.unreads_previous`, `workspace.unreads_mark_group`, `workspace.unreads_open`, `workspace.unreads_undo`) that the palette offers on that page and that you can bind to another key as well.

On a Mac, <kbd>Cmd</kbd> works wherever <kbd>Ctrl</kbd> is written. The timeline's own message
keys, such as <kbd>r</kbd> for a thread and <kbd>e</kbd> to edit, are in [Keyboard](keyboard.md).

**Contexts.** A binding belongs to a context: Global (everywhere), Composer, Message list,
Thread view, Conversation view, Panel (the rails, the tool panel and plugin panels) or Command
palette. It works where its context has focus; a global one works everywhere. In a text field,
keys that type a character and the editing chords stay with the field, unless a binding is made
for that very context.

**Settings → Keybinds** lists every default binding (the server's and the active keyboard
profile's), your bindings and this device's, grouped into Navigation, Chat, Panels, Agent,
Plugins and Other, with "Search keybinds..." above them. Each row names its context: Global,
Composer, Message list and so on.

- **Add keybind** opens a form: press the keys in "Press a key combination...", pick the
  command and the context, then **Save**. For a server command with arguments, **Arguments** has a
  field for each: the ones filled in are saved with the keybind, and a required one left empty is
  asked for when the key is pressed. A member or a conversation saved there keeps its workspace. The field records any keys, even ones already bound,
  and runs nothing while it has focus; <kbd>Escape</kbd> alone stops recording and keeps the
  earlier keys. Keys already bound in the chosen context show "\<keys\> is used by \<command\>.
  Saving moves it here and leaves \<command\> without a key." (or "…; \<command\> keeps its other
  keys."), and **Save** moves them to the new command; keys a workspace keybind holds cannot be
  taken: "\<keys\> is used by \<command\>, a workspace keybind. Choose other keys."
- On a binding of your own, the pencil changes its command, context or arguments (saved
  arguments the fields cannot show are kept as they are), clicking the keys records
  new ones, the switch turns it off, and the bin deletes it after "Delete keybind?". Keys
  recorded there that another binding holds wait under the row with the same note, **Save** and
  **Cancel**.
- The default rows carry the **Default** tag and cannot be edited, turned off or deleted here.
  A binding of yours on the same keys and context takes their place: **Override** opens the add
  form with the default's keys, command and context filled in, ready to change and save. A
  profile can free a key altogether.
  A command whose only keys a binding of yours took stays listed with **No key**; **Set key**
  opens the add form with that command and context.
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

**Vim mode.** The **Vim mode** switch in Settings → Keyboard, or the "Toggle Vim Mode" command,
adds a modal layer: <kbd>h</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>l</kbd> move in normal mode, and
a text field is insert mode ([Vim mode](keyboard.md#vim-mode)).

**The shortcuts panel.** <kbd>?</kbd> outside a text field, <kbd>Ctrl+/</kbd>, or **Show
shortcuts** in Settings → Keyboard opens "Keyboard shortcuts". It lists every binding in force,
grouped by context, with "Vim normal mode" while Vim is on, and "Filter shortcuts..." narrows it.

## Macros

A **command** is one action RIM or a plugin gives you. A **macro** is your own action, made of
commands that run one after another. Every macro is a command too, in the Macro category: it
shows in the palette, the keybind picker, Home quick boxes and the composer's `/` list, a key can
run it, and it works in every workspace you are in, on this server or another. Your macros are
kept on your home server for your account, and nobody else sees or runs them.

**Making one.** Settings → Macros, **New macro**, asks for a **Title** (no two of your macros
share one), a **Description** and up to 20 **Steps**. Each step has a command, picked from a
list you can search, grouped by category, with each command's description: the built-ins, the
app's own commands and the commands of the plugins installed on this device. Macros, the
commands that connect, answer and manage agents (**Connect an Agent…** among them), and Edit Home
are not offered. Under the command is a
field for each of its arguments. Fill one in to fix it, or tick **Ask when I run it** to be
asked each time. A step that takes a channel also offers the workspace's public channels you
have not joined, so a macro can join them and set their notifications, and message text can
have several lines. An argument the macro finds where it runs, such as the open workspace, the open
conversation or the selected message, can be left empty. **Save** stays blocked while a required
argument is neither fixed nor asked for, and the step says so. On the desktop, **Build with AI**
turns a description into steps with their arguments filled in, which open in the form to check.

**Running one.** Run a macro from the palette, a key, a quick box, the play button on its row
in Settings → Macros, **Run Macro…**, `/` in the composer, or `/macro <title>`, which finds it
whatever the letter case. The app runs it step by step, in the workspace, conversation and
thread you are in when it starts:

- **Asked arguments come first.** One form asks for every argument the steps ask for, each
  labelled "Step \<n\> · \<command\>: \<argument\>". Cancelling it runs nothing.
- **Each step runs as it would on its own.** A server command goes to the server that hosts the
  workspace, with its own confirmation when it needs one; an app or plugin command runs in the
  app. Steps do not pipe: each gets its own arguments.
- **A step that opens a form goes last.** A step that opens a form or a picker does not wait for
  you to finish it, so put it at the end. The form marks such a step when it is not last.
- **A failing step stops the rest.** The steps before it stay done, and the toast says
  `Step <n> (<command>) failed: <reason>`. A cancelled confirmation stops it the same way. A
  macro that finishes says `Macro "<title>" ran`.
- **Plugins never run your macros.** A plugin step whose plugin is not installed on this device
  fails with "its plugin isn't installed on this device".

**The AI agent.** Tick **The AI agent can run this** to let the agent run a macro as one
command, in the workspaces of your home server. It can be ticked only when every step is a
command the AI agent may run, which RIM's server runs, with every argument fixed; otherwise the
form says "Only commands the AI agent may run, run on RIM's server, with every argument fixed".
When the agent asks to run it, the confirmation lists the macro's steps with their arguments
([The AI agent](#the-ai-agent)).

**Limits.** You keep at most 100 macros, each with at most 20 steps and a title of at most 128
characters. A macro saved before steps could name other commands keeps any step that runs
another macro, shown as "Another macro (kept, no longer offered)".

**Workspace macros move into your macros.** Macros used to be kept per workspace. The first time
the app finds your home server keeping your macros, it moves the ones you made in each workspace
into your macros and deletes them where they were; one with the title and steps of a macro you
already have is only deleted, and one whose title is taken gets " (2)". At 100 macros the rest
stay where they are, and a toast says how many stayed in which workspace. Settings → Macros lists
the ones that stayed, at 100 macros or because the server refused them, under **Not moved yet**,
each with its workspace and the reason: **Try again** moves that workspace's macros once more,
and **Delete** deletes it from its workspace after a confirm. Settings → Commands is
gone: what it made are macros. With a home server that does not keep your macros, Settings →
Macros still lists the macros of the open workspace and Settings → Commands is still there.

Two macros, as examples:

- **Standup.** `chat.post_message` with the conversation set to #standup and the text
  "Standup: yesterday, today, blockers?", then `state.incr` with the key `standup.count`, which
  counts the standups in workspace state.
- **Heads down.** `notifications.mark_all_read`, then `notifications.dnd` with the mode `until`
  and **Ask when I run it** on its minutes: each run asks how long to pause your notifications.

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
  triggers. Each action runs even when an earlier one failed. On the Member Joined trigger, an
  action can also post as a bot: see "Post as bot" below.

**Where.** Settings → Pipelines, which is not shown in Direct messages. **New Pipeline** opens
"Create Pipeline" with **Name**, **Description**, **Trigger**, **Filters** (**Add filter**),
**Actions** (**Add action**, a command and an optional JSON arguments field) and **Cooldown
(seconds, optional)**, then **Save**. The list shows each pipeline as Active or Disabled, with
its trigger, its number of actions and, to its creator, when it last fired. The power button
enables or disables it, the pencil edits it, and the bin deletes it after a confirmation.

**Who.** Any member of the workspace can create a pipeline, and every member sees the list. Only
its creator, an Owner or a Moderator can change, toggle or delete it, and only they see the power
button, the pencil and the bin.

**What runs.** Nobody is there to confirm, so the server skips any action that would need a
confirmation: every mutating, restricted or dangerous command, which includes posting a message,
reacting and writing workspace state. Safe and sensitive server commands run. The editor's
command search offers only these, and says why above the actions; an action set to a command the
pipeline would skip, or to one that only runs in the app, is marked, and one whose text is not
a command id is marked "Unknown command: \<id\>" and not saved. A pipeline reacts
only to events its creator may see: a message in a private channel its creator is not in fires
nothing. On every firing, its creator, with the workspace open, sees "Pipeline "\<name\>"
fired", with how many of the pipeline's actions ran, such as "1 of 2 actions ran"; skipped
actions are not counted, and the toast is a warning when some did not run.

**Limits.** The cooldown stops a pipeline from firing again until it has passed. A pipeline that
fires more than 10 times in 60 seconds is switched off, with "Pipeline "\<name\>" suspended";
the power button turns it back on. You can create 50 pipelines per workspace, and the page shows
the server's own cap when it sets one.

**Post as bot.** With the Member Joined trigger, an Owner or Moderator on a server that has it
sees **Post as bot** beside **Add action**: a bot (active bots only), a channel (only that bot's;
"This bot is in no channels yet. Add it to one in Settings > Bots." otherwise) and a text. It says
plainly above them: "Posted by the bot, without asking anyone, each time someone joins." The text
takes `{username}`, the person's username, at their home server if they're from another one, and
`{name}`, their display name, or their username without one. What the server refuses, such as a
mistyped placeholder, shows beside the field. A welcome mentions nobody, and a name can't add a
mention or Markdown.

The list shows it to every member as "Post as Greeter in #welcome" with its text. A channel you
can't see shows as "a channel you can't see", never its name or id, and a bot your list doesn't
hold as "a bot". Who can't change it, such as a creator who is no longer a Moderator, sees it
read-only in the editor and can keep or remove it. A burst of joins is limited by the cooldown and
the bot's budget, which skip a welcome rather than queue it. The 10-firings limit below applies too:
a rush of people joining can switch the pipeline off. The list then shows it as Disabled like any
other, since the server keeps no reason, and only the creator's "suspended" notice, if they had the
workspace open, says why. The power button turns it back on.

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

Settings → State shows it, outside Direct messages. **Workspace** and **User** switch between
the workspace's scope and yours, and "Filter by prefix..." narrows the list. **New entry** asks
for a **Key**, a **Value (JSON)** and a **TTL (minutes, optional)**, then **Create**; each entry
can be edited and deleted, and shows when it expires.

- A key starts with a lowercase letter, uses `a-z`, `0-9`, `.`, `_`, `:` and `-`, and ends with
  a letter or digit. Keys starting with `system.` belong to the server.
- A value has at most 64 KB and lives at most 30 days when it has a TTL. The workspace's scope
  holds 10,000 entries and yours 1,000.
- Anything that reads a scope sees its values, the AI agent and its model provider included. Do
  not keep secrets there.

## The AI agent

On the desktop, the AI agent (<kbd>Ctrl+Shift+A</kbd>, or `/agent` in the composer) works
through the same commands and the same gates as you do. It sees only commands marked callable by
an AI: a reviewed set of built-ins, the plugin commands you approved in Settings → Plugin AI,
and your macros with **The AI agent can run this** ticked, each run as one command. A call that
changes anything waits for you in the confirmation dialog, headed "Agent wants to:", which lists
a macro's steps with their arguments, and the agent runs at most three such actions per run. Settings → AI Agent sets its provider and key, and
[Using a plugin](plugins.md#using-a-plugin) covers approving a plugin's commands for it. A
server's operator can turn its access off. In the web app it is not offered: the palette, the
keybind, the `/agent` suggestion and **Build with AI** are left out, and `/agent` typed in full
shows "The AI agent is available in the desktop app."

## Next

- [Keyboard](keyboard.md): how a key is resolved, the profile file and the Vim layer in full.
- [Plugins](plugins.md): installing, trusting and using plugins and their commands.
- [Command model](../../rim-server/docs/command_model.md): rim-server's contract for commands,
  sensitivity, confirmations, macros and what the agent may call.
