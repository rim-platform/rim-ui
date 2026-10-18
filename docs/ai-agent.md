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
  storage is only available in the desktop app."
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
  one, which it can only propose: it tells you, and you run it from the plugin's panel.
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
- **Chips**: the sensitivity in capitals, MUTATING or RESTRICTED, and **AGENT** for who started
  it.
- **Destination**: when the command names another conversation than the open one, "Destination
  differs from active conversation" with "Will post in conversation" and the first eight
  characters of its id.
- **Arguments**: up to ten, values cut at 200 characters, then "+\<n\> more arguments". A value
  that looks like a secret, or sits under a name such as password, token, key or secret, shows as
  `[REDACTED]`.
- **Buttons**: **Cancel**, and **Run anyway** for a Mutating command or **I understand —
  execute** for a Restricted one. A Restricted command first asks you to type its verb, the word
  after the dot in its id, as in `Type "delete" to confirm`. <kbd>Ctrl+Enter</kbd> confirms;
  <kbd>Esc</kbd>, the close button and **Cancel** cancel. A click outside the dialog does nothing.
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
Owners and Moderators see all of the workspace's. Masking keeps values out of the dialog and the
log, not out of the provider: the model wrote those arguments. Plugin commands run on this device;
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
