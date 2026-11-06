# The AI agent

The AI agent is a chat window in the desktop app that operates RIM for you: ask it a question or
give it a task, and it reads and acts through the same commands you run from the palette. This
page is for the person using it. [Commands and automation](commands-and-automation.md) explains
commands and their sensitivity, and rim-server's
[command model](../../rim-server/docs/command_model.md) is the contract behind both.

## What it is and is not

- **It runs commands, nothing else.** Every read and every change is a command that the server
  checks against your role in the workspace, as if you ran it. The agent cannot do more than you.
- **It is in the desktop app only.** The web app has no agent; its Settings → AI Agent says "Key
  storage is only available in the desktop app." It does not offer the agent's command, its
  keybind, the `/agent` suggestion or **Build with AI**, and shows "The AI agent is available in
  the desktop app." if the agent is opened another way.
- **You bring the model and the key.** It talks to Anthropic or OpenAI with your own API key, and
  the provider bills you for what it uses. RIM ships neither a model nor a key.
- **It never acts on its own.** It runs only when you send it a prompt, and stops when it has
  answered. A change waits for you in a confirmation dialog the agent cannot answer, and it cannot
  run your user commands, your macros, or a plugin command you did not approve.

## Setting it up

Settings → AI Agent, under Extensions. A notice at the top says that workspace data (messages,
channel names, member usernames) is sent to the provider you choose.

1. **Provider.** Anthropic (Claude) or OpenAI (GPT). Each provider keeps its own key, and
   switching shows whether the other one has a key set.
2. **API Key.** **Get API key** opens the provider's key page. Paste the key and press **Verify &
   Save**: the app asks the provider whether the key works and stores it only if it does. The pill
   beside the label turns from "No key configured" to "Key set", and the line under the field says
   "Key verified and saved." A refused key gives "Invalid key — not saved. Check and try again."
   and an unreachable provider "Could not reach \<provider\>. Key not saved — check your network
   and retry."; in both cases the key already stored stays. The bin ("Remove stored key") deletes
   it.
3. **Model.** Shown once a key is set. The list is the provider's own, newest first, with
   "\<n\> models loaded from API" under it, and the refresh button fetches it again. When the
   chosen model is no longer offered, the newest is selected. When the list cannot be fetched, the
   error shows under it and a short built-in list stands in.
4. **Custom System Prompt (optional).** Your own instructions, added after the agent's built-in
   ones, never in their place.

**Where the key lives.** The key goes into the [secret vault](secret-vault.md), the encrypted file
that holds the desktop app's secrets. The app's Rust side reads it from there for every request
and calls the provider itself, so once saved the key is not held by the web view that draws the
app, by plugins or by the developer tools. The provider, model and prompt are kept in the app's
local storage on this device. The same key serves **Build with AI** in Settings → Macros.

**A server with AI commands off.** A server's operator can switch off its AI command surface.
Settings → AI Agent then says "The AI command surface is switched off on this server." and
opening the agent shows only that notice. The server refuses agent runs either way.

## Using it

**Opening it.** <kbd>Ctrl+Shift+A</kbd>, or **Open AI Agent** in the palette, opens "RIM Agent"
over the app. Sending `/agent` with some text from the composer opens it too; the text is not
passed on, so ask in the agent itself. The first time, "AI Agent — Data Sharing Notice" says what
goes to the provider: **I understand** goes on, **Cancel** closes the agent.

**A conversation.** The header shows the provider and the model, **+** for a new conversation,
and the close button. Type in "Ask the agent..." and press <kbd>Enter</kbd>. The answer streams
in as Markdown. While it runs, the stop button or <kbd>Esc</kbd> stops it; otherwise
<kbd>Esc</kbd> closes the window. After an answer the footer shows the tokens it used, as
"\<n\> in / \<n\> out tokens". Further prompts continue the conversation while the window stays
open; opening it again after an answer starts a new one.

**What it knows.** Each run tells the model the ids of the open workspace and conversation and
whether a thread is open, and every command it runs gets the same context: the workspace, the
conversation and, with a thread open, the thread. It sees no message until it reads one with a
command, and no name until it lists them. `get_current_context`, the one tool the app defines
itself rather than the server, returns that context again during a run.

**Tool calls.** While it works, a line under the conversation names the call: "Using
\<command\>..." while the model asks for it, "Running \<command\>..." while it runs. A built-in
command shows by its id, such as `chat.search_messages`; a plugin command as
`plugin__<plugin id>__<command>`, with the dots of the plugin id turned into underscores. Results
are not printed: the model reads them and tells you what it found. A failed call reaches it as a
short error with web addresses and file paths removed.

**What it reads.** What the commands below return to you: channel lists, members, recent
messages, search results, workspace state, and what approved plugin commands return. A private
channel you are not in stays out of its reach, as it does out of yours.

## What it may do

The agent is offered only the commands marked callable by an AI that your role in the open
workspace may run:

- **Built-in commands**, a reviewed set the server lists per workspace, marked AI-callable in the
  [command model](../../rim-server/docs/command_model.md#built-in-commands). They cover reading
  channels, members, recent messages and search; posting, reacting and pinning; creating, joining,
  leaving, archiving and inviting to channels, and creating a group; a moderator's timeout, slow
  mode and reports; notification level, do not disturb and marking read; workspace state; and
  moving around the app, such as switching conversation or workspace and opening a thread, search
  or Settings.
- **Plugin commands** a turned-on plugin marks callable and you approved in Settings → Plugin AI
  ("Plugin AI Access"). Each plugin's row shows "\<n\> / \<m\> AI commands approved"; its
  checkboxes, **Approve all** and **Revoke all** change that, and the first approval asks in
  **Grant AI Access?** (**Grant Access**). **Revoke all grants** takes back every plugin's
  approvals. The agent calls an approved command without asking each time, except a dangerous
  one, which it can only propose: it tells you, and you run it yourself in RIM.
  [Using a plugin](plugins.md#using-a-plugin) has the rest.

It never sees user commands, macros or any command not marked callable. Kept off the AI surface on
purpose: editing and deleting messages, kicking, banning, changing roles, removing members and
inviting to the workspace.

**Limits of a run.** A run is one prompt and everything the agent does to answer it.

- At most three changes: calls of Mutating or Restricted commands, counted when the agent makes
  them, whether you confirm or not. A fourth is skipped, and the agent is told to ask you to start
  a new run. Reads, moving around the app and plugin commands do not count.
- At most three tool calls at once; the rest go back to the agent to issue again.
- At most ten rounds of tool calls, after which it says "(Reached maximum tool call limit)".
- At most ten runs a minute: "Rate limit exceeded: maximum 10 runs per minute. Please wait a
  moment."

## Confirmations

The server decides which calls wait for you. For the agent that is every Mutating and Restricted
command; Safe and Sensitive ones run at once
([Sensitivity](commands-and-automation.md#what-a-command-is)). A call that waits opens this
dialog:

- **Header**: the **RIM** badge ("Verified RIM system dialog") and "Confirm command".
- **Title**: "Agent wants to:" and the command's id, with the command's description under it.
- **Chip**: **AGENT** when the agent proposed it.
- **Destination**: when the command names another conversation than the open one, "Destination
  differs from active conversation" with "Will post in conversation" and the first eight
  characters of its id.
- **Warning**: when the agent proposed the command after a tool call of the same run returned
  something, "This action was suggested while the agent was reading external content. **Verify it
  matches your intent.**" Anything a tool returns counts: messages, search results, a plugin's
  output, a cancellation or a skipped call, since any of it can carry instructions someone planted
  for the agent. A call the agent makes straight from your prompt, before any tool returned,
  shows no warning, and each new prompt starts afresh.
- **Arguments**: up to ten, values cut at 200 characters, then "+\<n\> more arguments". A value
  that looks like a secret, or sits under a name such as password, token, key or secret, shows as
  `[REDACTED]`.
- **Buttons**: **Cancel**, and **Run anyway** for a Mutating command or **I understand —
  execute** for a Restricted one. A Restricted command first asks you to type its verb, the word
  after the dot in its id, as in `Type "delete" to confirm`; so does a Mutating command under the
  warning. <kbd>Ctrl+Enter</kbd> (<kbd>⌘ Return</kbd> on macOS, as the button shows) confirms;
  <kbd>Esc</kbd>, the close button and **Cancel** cancel. A click outside the dialog does
  nothing.
- **Expiry**: the server's confirmation is valid for 60 seconds. When it runs out, the dialog
  closes and counts as cancelled. If it lapses as you confirm, the dialog opens once more.

A cancelled call reaches the agent as "Action cancelled by user." The agent never confirms
anything itself: it has no tool for the dialog, and the server runs a held command only with the
single-use proof the dialog sends after your click, bound to you, the command and the exact
arguments shown.

## Encrypted conversations

The agent is off in every end-to-end encrypted DM and group until you turn it on for that one.
**Conversation menu** in the header has "Agent: off in this conversation"; choosing it asks "Let
the agent use this encrypted conversation?": "The text of this conversation goes to the model
provider. It leaves this device and is no longer end-to-end encrypted once the agent reads it."
**Turn on** allows it, and the entry becomes "Agent: on in this conversation", which turns it off
again without asking. The switch is per conversation and kept on this device.

While it is on, the agent reads recent messages and searches in the local message cache, and a
search across the workspace adds this device's hits from the encrypted conversations it is on in.
Every post asks first, in the dialog above: "Agent wants to: chat.post_message" with "Send this
message, encrypted, in an end-to-end encrypted conversation." and **Run anyway**, valid for five
minutes. A group the agent creates starts as a plaintext group, which this desktop upgrades once
every member is ready. Where the agent is off, it is told so, and that you can turn it on from
the conversation's menu. [Encrypted DMs and groups](e2ee-desktop.md) has the details.

## Privacy

Requests go from this desktop straight to the provider, not through the RIM server. They carry:

- your prompts, and the earlier prompts and answers of the conversation;
- the agent's built-in instructions, your custom prompt, and the ids of the open workspace and
  conversation;
- the commands it may call, with their descriptions and arguments;
- every call's arguments and result: the messages it reads, channel and member names, workspace
  state values, plugin results and error text, and in an encrypted conversation the agent is on
  in, its text.

On this device stay the key, in the secret vault; the five most recent conversations, as text
without their tool results, in the app's local storage; the settings; and the encrypted switches.

The RIM server runs the agent's built-in commands as it runs yours and records each in its audit
log with the initiator `agent`. Arguments that look secret are stored as `[REDACTED]`, by the same
rules as the dialog. The **Audit log** in the side rail shows your own entries, and a workspace's
Owners and Moderators see all of the workspace's. Each entry names who ran it and, for an action
on a member, that member. Masking keeps values out of the dialog and the log, not out of the
provider: the model wrote those arguments. Plugin commands run on this device;
`rim.log` records each one the agent calls by plugin and command id, and the saving, removal or
absence of a provider key, never the key itself.

## Troubleshooting

- **"Please configure your API key in Settings → AI Agent."** The chosen provider has no key.
  Keys are per provider, so check the provider shown in the agent's header.
- **"Error: provider returned error \<status\>: …"** The provider refused the request and the rest
  is its own message. A 401 means it no longer accepts the key; a 404 that names the model means
  the model is gone: refresh the list under Model and pick another.
- **"Error: network error: …"** The provider could not be reached during a run.
- **"The AI command surface is switched off on this server."** The operator turned it off; only
  they can turn it back on.
- **"secret storage error: …" under the key field, or "No key configured" for a key you saved.**
  The secret vault did not open, for example with the Linux keyring locked
  ([When the vault does not open](secret-vault.md#when-the-vault-does-not-open)).
- **The agent says it has no way to act.** The server's command list did not load, and the agent
  has only `get_current_context` until you switch workspace or restart the app.

The desktop app writes `rim.log`, and Settings → About has **Open log folder**
([Logs](install.md#logs)). It holds the agent's errors and the key events above, never message
text or keys.

## Agents on this computer

Apart from the agent above, a program that runs on your computer with its own model provider, such
as Claude Code, can ask to connect to the desktop app. **Settings → Agents** holds the switch, which
is off by default. It is optional, and RIM works the same without it. The web app does not have it.

- **The switch.** **Let agents on this computer connect** makes the app listen on a port that only
  this computer can reach. While it is off, nothing listens and connected programs cannot reach RIM.
  If something else holds the port, the tab says so.
- **Connecting a program.** The program asks to connect and shows a code. The app comes forward and
  shows a dialog with the same code and the name the program gives itself. That name is the
  program's claim; RIM has no way to check it. Compare the codes, then choose **The code matches,
  connect** or **Don't connect**. Closing the dialog or pressing Escape refuses, and a request that
  nobody answers expires after two minutes. After a refusal or an expiry, a new request is turned
  away for ten seconds. An account has to be unlocked for any of this, and locking it closes the
  dialog.
- **What a connected program gets.** A token, once, which works for this account on this device
  only. It is listed as connected when it collects that token, and a program that doesn't within
  two minutes of your approval is not connected. RIM keeps only the token's hash. A server knows nothing about connected programs, and the
  token does not reach one.
- **Disconnecting.** Each connected program has a **Disconnect** button in the tab. It stops the
  program reaching RIM. It takes nothing back: what the program has already read stays with it.

A connected program can read only what you grant it, and it can change nothing without you
confirming that one change, unless a plugin says a command you approved only reads:

- **Grants.** Everything starts off. **Choose what it can read** on a program's row gives that
  program one or more channels, or **All channels you can see** in a workspace. That includes private
  channels you're in and channels you join later. Reads within a grant don't prompt. You can change
  a grant at any time, and the change applies to the program's next call. Grants stay on this
  device, sealed with your account. Only workspaces on your own server are offered: one hosted on
  another server can't be granted yet.
- **What it can ask.** Seven tools, over the Model Context Protocol: `rim_list_workspaces`,
  `rim_list_channels`, `rim_read_messages`, `rim_search_messages`, `rim_send_message`,
  `rim_list_plugin_commands` and `rim_run_plugin_command`. Each acts on the workspace it names,
  whichever one you have open. A message comes with its id, channel,
  thread, the author's display name, its text, its times, and each attachment's name, type and size.
  Text that people wrote is marked untrusted, which makes it less able to steer the program but
  cannot make that impossible.
- **Where it reads from.** The messages stored on this device. A channel not stored yet gets a
  refusal saying to try again shortly, and RIM starts storing it. A channel you can no longer see
  is refused, and a change can take up to 30 seconds to show. A search of a whole workspace looks at
  the first 100 hits and keeps those within the grant, so it can miss some: naming the channel
  doesn't.
- **What stays closed.** Encrypted conversations, direct messages and groups are refused and
  dropped from search. There is no grant that opens them. A refusal reads the same whether a channel
  is closed, not granted, or does not exist.
- **Sending.** A program can ask to send a message to a channel its grant covers, and nowhere else:
  encrypted conversations, direct messages and groups are refused the same way, and nothing is sent.
  The app comes forward with a dialog showing the program's name, the workspace, the channel and the
  whole text with its length, with invisible and direction-changing characters shown by name. The
  text is what you are confirming, and the program may have read something meant to steer it, so
  read it. What you discard never leaves this device: the text goes to the server only after you confirm, and
  the app then answers the server's own confirmation for you. **Send** stays disabled for the first second, so a click or key press meant for something else
  can't answer it. Cancel, Close and Escape discard the message, and if you don't answer it expires
  after 60 seconds. The program hears which of those happened. After a discard or an expiry, that
  program's next request within 10 seconds is refused. While any dialog is open, a program's
  request is refused and can be retried; your own commands replace a program's dialog, which ends as
  discarded. Locking the account or turning the switch off also ends it as discarded. The message
  goes out under your name, and the others in the channel are not told a program wrote it. The audit
  log records that an agent started it, which an Owner or Moderator can read. The server's AI
  command switch applies: on a server that has it off, sending is refused before you're asked.
- **Plugin commands.** Nothing is approved to start with, and what you approved for the agent above
  doesn't carry over. **Choose its plugin commands** on a program's row lists, for each turned-on
  plugin, the commands it offers to agents, and you tick them one by one. A command the plugin
  marks `read_only` runs without asking. That is the plugin's claim: RIM can't check it, and the
  screen says so. Any other approved command opens a dialog like the one for sending, with the
  plugin, the command, what the plugin says about it marked as the plugin's words, and every argument
  in full, except values that look like secrets, which are masked. Discards, expiries, the 10 seconds
  after them and a dialog already being open work as they do for sending, and the 10 seconds cover
  both. A dangerous command is only suggested: the program tells you, and you run it yourself in RIM. "Uses:" lists the capabilities a command needs, and the plugin's heading
  lists all it can use. A plugin holding `chat.read` can read every conversation you can and return it, whatever you chose the program can read, and the screen warns of this. One holding `chat.read.encrypted` can read an encrypted conversation
  itself and return it, and the screen warns of this. When a plugin's manifest changes, its approvals stop working and the screen asks
  you to choose again. The program gives any ids a command needs, and a command never uses what you
  have open. One that needs a workspace or a conversation, or is given a `workspace_id` or `conversation_id`,
  runs only where the program has a grant. A plugin can name such an argument anything else, or read
  by itself what its capabilities allow, and a grant can't limit that.
  What a command returns goes to the program marked untrusted, up to 512 KiB. A refusal reads the
  same whether a command isn't approved, its plugin changed or is turned off, or it doesn't exist.
- **The record.** **What it was given** lists what RIM handed to that program, what it asked to send
  or run and what it refused: when, which tool, which channel, how many messages and their ids, how a
  request to send ended, with the message's id if it went out, and which plugin command was run,
  asked for or suggested. It never holds a command's arguments or what it returned. **What agents were given** lists it
  for every program, including those since disconnected. It holds no message text and no search
  text. It stays on this device for 30 days, up to 2,000 entries for each program, of which at most
  500 refusals, so a program can't push out what another was given, or bury what it was given in
  refused calls. **Clear the whole record** clears it for every program and leaves one line saying
  you did. It is a record of what RIM handed over, not of what
  the program did with it.
- **Opening it.** The command **Open Agents** opens this screen from the palette or a key you bind it to. No program gets a tool that opens it.
- **Runs.** **Its runs** (or **All runs**) groups the record into runs: one program's calls with no
  more than 15 minutes between them. A run is a grouping by time, not a task: RIM doesn't see where a
  program's task starts or ends, nor what it did between two calls, which model it used, or where
  the content went. A run opens to its steps, what the workspace host recorded for it, where the
  content goes and what the program may read now. The host's lines are your own audit entries
  carrying the run's identifier (the app sends it with the changes of a run); those who can read
  that workspace's log can read them too. A change to what a program may read or run starts a new
  run. Runs are shown on this device only, and nothing in
  them stops a program: **Disconnect** and the grants do.

The [contract for what agents are given](https://github.com/rim-platform/rim-server/blob/master/docs/specs/agent-data-flow-v1.md)
is rim-server's.

There are limits to what this does:

- RIM controls what it hands to a program. It does not control what happens after that: what a
  program reads goes to its model provider, and RIM can't see or limit where it goes from there.
- Connecting keeps an ordinary program from reaching RIM by accident. It is not a boundary against
  malware. Another program running as you can do what you can, so connect only programs you trust.
- The desktop app enforces these rules, and a server does not know about them, so they do not bind
  a modified client.

### Claude Code

Claude Code connects through a plugin in this repository:

```sh
claude plugin marketplace add rim-platform/rim-ui
claude plugin install rim@rim-platform
```

Then say "connect to RIM" in Claude Code. The steps are in the
[plugin's README](../integrations/claude-code/README.md).

## Next

- [Commands and automation](commands-and-automation.md): sensitivity, the palette, macros and
  pipelines.
- [Plugins](plugins.md): installing and trusting plugins, and approving their commands for the
  agent.
- [Encrypted DMs and groups](e2ee-desktop.md): how the agent, plugins and pipelines treat
  encrypted conversations.
- [Secret vault](secret-vault.md): where the provider keys are kept.
- [Command model](../../rim-server/docs/command_model.md): rim-server's contract for commands,
  confirmations and the AI-callable set.
