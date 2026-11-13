# Connect an AI agent

An outside agent is a program on your computer that works with its own AI model, such as Claude
Code. You can connect it to the RIM desktop app, choose which channels it may read, and approve
each message before it posts. This page shows how. It is for the person using RIM.

## Which one do I need?

- The **Assistant** is built into RIM, uses your own AI provider key and answers in a panel
  (<kbd>Ctrl+Shift+A</kbd>). It is set up in Settings > Assistant ([The assistant](ai-agent.md)).
- **Agents** are programs on your computer, such as Claude Code or Codex, that you connect to RIM
  or that RIM starts, and they see only what you grant. This page is about them.
- Both are in the desktop app only, and RIM works the same without either.

The two are separate: what you allow one doesn't carry over to the other. Settings > Agents
starts with a line saying what agents are for, with a link to Assistant.

## Before you start

- **You need the desktop app.** The web app can't connect agents.
- **The agent runs on the same computer** as the app. Nothing on another computer can connect.
- **It's optional, and off until you turn it on.** RIM works the same without it.
- **Your account must be unlocked** while you connect an agent.

## Turn it on

Open **Settings > Agents** and turn on **Let agents on this computer connect**. The app then
listens on a port that only this computer can reach. If another program already uses that port,
the tab says so.

While the switch is off, nothing listens. Agents you connected earlier stay in the list, but they
can't reach RIM until you turn it on again.

## Connect Claude Code

RIM ships a plugin for Claude Code. Claude Code fetches it from GitHub itself, so there is nothing
to clone or download by hand. Install it once: open a terminal and run

```sh
claude plugin marketplace add rim-platform/rim-ui --sparse .claude-plugin integrations/claude-code
claude plugin install rim@rim-platform
```

These two lines go in a terminal, not in Claude Code's chat.

- `rim-platform/rim-ui` is the plugin's repository on GitHub. The full address,
  `https://github.com/rim-platform/rim-ui.git`, works the same.
- `--sparse` makes Claude Code check out only the two folders the plugin needs, not the whole app.
- Claude Code reads the repository's default branch. To stay on one release, add `#` and its tag
  after the repository, as in `rim-platform/rim-ui#<tag>`.
- Building RIM from source, or trying the plugin before a release? Add it from your checkout
  instead: `claude plugin marketplace add /path/to/rim-ui`. `--sparse` doesn't apply to a folder.

Then:

1. Start Claude Code (`claude` in a terminal) and type "connect to RIM" in its chat.
2. Claude Code shows a code. RIM comes to the front and shows a dialog with a code too.
3. Check that the two codes are the same. Then choose **The code matches, connect**.
4. Restart Claude Code, or type `/mcp` in its chat.

If the codes differ, or you didn't ask for this, choose **Don't connect**. Closing the dialog or
pressing Escape also refuses. A request nobody answers ends after two minutes.

The name in the dialog is what the program calls itself. RIM can't check it, so the code is what
tells you it's the program you started.

Claude Code keeps its token in `~/.claude.json`, which any program running as you can read. The
[plugin's README](../integrations/claude-code/README.md) has the details.

**Other agents.** Any other program that speaks the Model Context Protocol connects from RIM
instead: see the next section.

## Connect another agent

Codex, opencode, Gemini CLI, Cursor, VS Code and other MCP tools connect from inside RIM. Claude
Code can too, if you'd rather not use the plugin.

1. Open **Settings > Agents** and choose **Connect an agent**. The command palette's **Connect an
   Agent…** opens the same dialog.
2. Type a name: what you'll call it in RIM, for example "Codex on laptop". Choose **Connect**.
3. RIM adds the agent, with nothing granted, and shows its setup **once**:
   - the address, `http://127.0.0.1:47821/mcp`;
   - the token, hidden until you choose **Show**, with **Copy**;
   - a tab for each tool, with the setup to paste, the token already in it, and where it goes.
4. Paste the setup into the tool, then choose **Done**. The agent is in the list like one that
   paired, and can read nothing until you choose what.

There is no code to compare: you started it inside RIM. While **Let agents on this computer
connect** is off, the dialog says so and offers the switch, and connects nothing.

The setup each tab gives, with your token in place of `TOKEN`:

| Tool | Where it goes | What it adds |
|---|---|---|
| Claude Code | a terminal; it saves to `~/.claude.json` for your user, so it works in every folder | `claude mcp add --transport http --scope user rim http://127.0.0.1:47821/mcp --header "Authorization: Bearer TOKEN"` |
| Codex | `~/.codex/config.toml` | a `[mcp_servers.rim]` table with `url` and `http_headers = { Authorization = "Bearer TOKEN" }` |
| opencode | `~/.config/opencode/opencode.json` | `mcp.rim` with `"type": "remote"`, `url`, `"enabled": true` and `headers` |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers.rim` with `httpUrl` and `headers` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers.rim` with `url` and `headers` |
| VS Code | your user `mcp.json` (**MCP: Open User Configuration**) | `servers.rim` with `"type": "http"`, `url` and `headers` |
| Generic | any MCP client that speaks streamable HTTP | the address, and the header `Authorization: Bearer TOKEN` on every request |

Merge a JSON setup with what the file already holds. Use the file in your home folder, not one
inside a project, so the token isn't shared or committed with the project.

**Keep the token safe.** The token is saved in that tool's settings file. Any program running as
you can read it. RIM won't show it again. If you lose it, disconnect this agent and connect again.

**If it doesn't connect:**

- The tool must use the streamable HTTP transport. RIM doesn't serve the older SSE transport, and
  answers anything but a `POST` with 405.
- VS Code and Gemini CLI fall back to SSE when streamable HTTP fails, so an error about SSE means
  the first attempt failed: check the address, the token and that the switch is on. In Gemini CLI,
  the key is `httpUrl`; `url` there means SSE.
- A wrong or disconnected token gets 401. opencode then starts its sign-in flow, which can't work
  with RIM: connect again and paste the new token.
- RIM must be running and unlocked. A locked account answers 423.

## For tool authors: the pairing protocol

A program can also ask to connect itself, the way RIM's Claude Code plugin does. The person
compares a code and approves in RIM, and the program collects its token once.
[`pair.sh`](../integrations/claude-code/scripts/pair.sh) is a working example.

Every request is a `POST` to `http://127.0.0.1:47821` with `Content-Type: application/json`, a
`Host` of `127.0.0.1:47821` or `localhost:47821`, no `Origin` header, and a body of at most 1 MiB.
Answers are JSON.

**1. Ask.** `POST /pair` with `{"name": "<what the program calls itself>"}`. RIM removes control
and invisible characters from the name, collapses spaces and keeps the first 64 characters.

- `200 {"requestId": "...", "pollSecret": "...", "code": "123456", "expiresIn": 120}`: RIM shows
  the person the name and the code. Show the same six-digit code to the person, and keep the poll
  secret to yourself.
- `400 {"error": "bad_name"}`: nothing visible is left of the name.
- `409 {"error": "pairing_in_progress"}`: another request is waiting for the person.
- `429 {"error": "try_later"}`: a request was refused or expired less than 10 seconds ago.

**2. Poll.** `POST /pair/poll` with `{"requestId": "...", "pollSecret": "..."}`, every couple of
seconds:

- `200 {"status": "pending"}`: the person hasn't answered yet.
- `200 {"status": "approved", "token": "rimagent_..."}`: the person approved. This answer comes
  once; the token is never handed over again.
- `200 {"status": "refused"}` or `200 {"status": "expired"}`: it's over. A request expires 120
  seconds after it started, and an approved token not collected within 120 seconds is thrown away.
- `404 {"error": "unknown_request"}`: no such request, or a wrong poll secret. The two are answered
  alike.

**3. Use the token.** Send MCP JSON-RPC messages as `POST /mcp` with `Authorization: Bearer
<token>`. A token RIM doesn't know, or one whose agent was disconnected, gets
`401 {"error": "not_paired"}`.

**Answers from any path:**

| Status | `error` | Why |
|---|---|---|
| 400 | `bad_body` | the body isn't a JSON object (`/pair` and `/pair/poll`) |
| 403 | `bad_host`, `has_origin` | the `Host` isn't local, or an `Origin` header was sent |
| 404 | `not_found` | another path |
| 405 | `method_not_allowed` | not a `POST` |
| 408 | `slow_body` | the body didn't arrive within 10 seconds |
| 413 | `too_large` | the body is over 1 MiB |
| 415 | `bad_content_type` | not `application/json` |
| 423 | `locked` | the person's account is locked |
| 429 | `busy` | too many requests at once |
| 503 | `not_ready` | the app didn't take the request in time |
| 504 | `timed_out` | the app took it but didn't answer within 120 seconds |
| 500 | `internal` | answering failed |

Store the token where only the person can read it, and never print it or put it in a model's
context.

## Agents RIM starts

The desktop app can also keep a list of agent programs it may start itself, under **Settings >
Agents**, **Agents RIM starts**. The web app can't: it says "Starting agents needs the desktop
app". Each one is a program that speaks the Agent Client Protocol, and RIM starts it as you, with
access to your files.

**The supported agents.** The section lists Claude Code, opencode, Goose, Codex and Gemini CLI,
one row each, with what RIM finds for it on this computer:

- **Install**, with the version and licence RIM would install, how big it is and where it comes
  from, when it isn't installed and isn't on your `PATH`. The size is the download for Claude
  Code, opencode and Goose, and what npm puts on disk for Codex and Gemini CLI.
- **Installed by RIM** and its version, with what its files use, **Update to** a newer version
  when there is one, and **Remove files**.
- **Found on this computer**, when it's on your `PATH` because you installed it yourself.
- **Not available on this computer**, with the reason, when RIM can't install it here.

Under the list, one line says what the agents RIM installed use on this computer in all,
including RIM's Node.js and the agents that run on it.

**RIM installs it for you.** **Install** shows one system dialog, not a page of RIM, that names
the agent, its version, its licence, where it's downloaded from and, when RIM could tell, how big
it is and what Node.js adds. Only **Install** goes on:

- RIM takes the version from the Agent Client Protocol registry, and downloads only from the
  source fixed for each agent: the agent's own release on GitHub for Claude Code, opencode and
  Goose, the npm package for Codex and Gemini CLI. A registry entry that points elsewhere is
  refused.
- It checks each download against its checksum before it unpacks it, and npm checks its packages
  itself.
- Codex and Gemini CLI run on Node.js. RIM downloads its own Node.js once, from nodejs.org, and
  uses it even when your computer has its own. Their packages install without running their
  install scripts.
- Everything goes into RIM's own folder; nothing is installed for the whole computer. RIM keeps
  no download cache: each download and npm's cache are deleted once the install ends.
- RIM may then start the program it installed, so no second dialog asks. RIM adds it to
  **Your agent programs** and connects an agent for it, with nothing granted.

The row says how far it got: downloading Node.js, downloading with how much of it arrived,
checking, unpacking and installing. **Update to** installs the new version the same way, moves
the agent to it and only then deletes the old one. **Remove files** asks first, deletes the
agent's files, removes it from **Your agent programs** and disconnects its agent; RIM refuses
while one of its sessions runs.

**Or use one you installed.** An agent on your `PATH` keeps working as before.

1. Choose **Add**, then a preset or **Custom…**.
   - The presets are Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Gemini CLI
     (`gemini --acp`), opencode (`opencode acp`) and Goose (`goose acp`).
   - **Custom…** asks for a name, the program (a full path, or a name found on your `PATH`) and
     its arguments, one per line.
   - Each can have a default folder, the full path of the folder its sessions start in. Write it,
     or choose **Browse…** to pick it in your system's folder dialog.
2. Choose **Add**. A system dialog asks whether RIM may start that program with exactly those
   arguments. Only **Allow** saves it. Changing the program or its arguments later asks again;
   changing the name or the folder doesn't.
3. RIM connects an agent for it, with nothing granted, as **Connect an agent** does. It's in the
   list above with the others, and you choose what it may read the same way.

A program that RIM can't find on your `PATH` any more shows **Not found**: install it from its
row, or **Edit** it to point at the one you installed.

**Sign in.** Each agent needs you to sign in to its own service once. Choose **Sign in** next to
an agent in **Your agent programs**, or right after installing it. RIM starts the agent for a
moment, asks how it signs in, and shows each way it offers, with its name and description:

- **Open terminal** opens your computer's terminal running the agent's own sign-in, after a
  system dialog that shows the exact command. Finish signing in there, then come back. When RIM
  finds no terminal, it shows the command to copy and run in one. RIM doesn't open a terminal
  that would change variables such as `PATH`, `LD_PRELOAD`, `NODE_OPTIONS` or a proxy.
- **Sign in** asks the agent to sign in itself: it usually opens your browser, and RIM waits up
  to ten minutes while you finish there.
- A way that reads environment variables names them. Set them before starting RIM: RIM doesn't
  set them for you.
- Goose and opencode set up with `goose configure` and `opencode auth login`; when they name no
  way of their own, **Open terminal** runs those.

What you sign in with stays with the agent: RIM never sees your passwords, keys or tokens. When a
session finds the agent isn't signed in, it shows **Sign in to** the agent; once you have,
**Try again** starts the agent again in the same folder and sends the prompt it refused.

The agent keeps its own settings, its own tools and its own permission rules. **Remove** stops
RIM starting the program and disconnects its agent; the files of one RIM installed stay until
you choose **Remove files**. Disconnecting that agent in the list above removes the program from
this list too.

## Sessions

A session is one agent program, started by RIM in a folder you choose, that you direct from RIM.
Sessions run in the desktop app only; the web app says "Starting agents needs the desktop app".

**Start one.** Open **Agent sessions**: the **Open agent sessions** button in **Settings > Agents**,
or **Open Agent Sessions** in the command palette. Choose **Start a session**, or run **Start
Agent Session…**. Pick one of your agent programs (one RIM can't find is shown but can't be
picked) and the full path of the folder it works in, which starts as the program's default folder.
Write the path, or choose **Browse…** to pick the folder in your system's folder dialog.
RIM doesn't sandbox the agent: it runs as you in that folder, with its own tools and permission
settings. The session says so under its header.

**Tell it what to do.** Write in the box at the bottom and press Enter; Shift+Enter adds a line.
Only what you write there is sent to the agent: nothing it reads in RIM, no message from someone
else, no macro, plugin or command, and nothing the agent itself sends becomes a prompt. The box
waits while the agent works, and says why.

**Follow it.** The agent's answer appears as it writes it. Its thinking is folded under
**Thinking**. Each tool call is a card with its kind, title and status (pending, running, done,
failed or cancelled); open it to see the files it changed, as removed and added lines, the text it
returned, the files it touched and what it was called with. A plan shows as a checklist. All of it
is shown as plain text: nothing the agent sends runs in RIM.

**Approve or refuse.** When the agent asks before a step, a card shows what it wants to do and a
button for each answer it offers, such as **Allow once**, **Always allow** or **Reject**. Only
those buttons answer it: no command, keybind, macro, plugin or agent can. What "always" means is up
to the agent and its own settings.

**Cancel or stop.** **Cancel turn** stops what the agent is doing now and refuses its waiting
requests; the session stays open for your next prompt. **Stop** ends the agent program, after
asking while a turn is running; **Stop Agent Session** does the same for the session that's open.
Quitting RIM stops every session. Closing the window to the tray keeps them running, and signing
out stops them.

**The agent's settings.** Under the header, the session shows the settings the agent offers, such
as its model, reasoning effort or mode, each as a list with the agent's name for it, the model
first. Changing one asks the agent, which answers with all its settings as they now are; when it
refuses, the session says why. They can't change while a turn is running. An agent that offers no
such settings but has a list of models gets a **Model** list, and one with only modes a **Mode**
list. RIM remembers the model you chose last for each agent program, and a new session of it
switches to that model before your first prompt when the agent still offers it; otherwise the
agent's own default stays. Only you change these, from the session: nothing an agent or a message
sends does.

**RIM's tools.** When **Let agents on this computer connect** is on and the agent can reach an
MCP server over HTTP, the session gets RIM's tools under the agent RIM connected for the program,
with what you granted it and nothing more. Otherwise the session says that RIM's tools are off, or
that the agent can't use them, and the agent works with its own tools only.

**Notifications.** When an agent starts waiting for your answer, or finishes a turn, while the RIM
window isn't in front, the desktop shows "<agent> is waiting for you" or "<agent> finished", with
the session's title and nothing else from the session. While RIM is in front but you're not on
that session, the same words show as a notice in the app with **Open** instead, never both. On
the session itself nothing shows. They follow your notification settings, and the open
workspace's pause and quiet hours. Choosing one opens the session.

**Running and recent.** **Agent sessions** lists the sessions running now, as Working, Needs
you, Ready or Failed, and up to 20 recent ones, with the agent, the title, the folder and when
it last did something. The title is the one the agent gives the session, or the start of your
first prompt. A dot marks a session that finished or started waiting since you last had it open.
The **Agent sessions** box on Home shows the same, up to six, with **New session** and **All
sessions** ([Home](home.md)). So does the **Agent sessions** button in the top bar, once you've
added an agent program: it shows how many sessions wait for you, or a dot while one is working,
and opens that list under the bar.

**Transcripts aren't kept.** RIM keeps a session's transcript in memory while the app runs, and
never stores it. The recent list keeps only the agent, the folder, the agent's id for the session,
the title and the times, sealed with your account on this device. The agent may keep its own
history, in its own way.

**Reopen one.** Choosing a recent session that isn't running starts its program again and asks
the agent to open that session, when the agent can: it shows the history it kept. An agent that
can't says "<agent> can't reopen past sessions. Start a new one." **Remove** only takes a session
off the list.

## Ask agent about a message or channel

In the desktop app, a channel's menu has **Ask agent about #channel**, and a message's menu has
**Ask agent…**. The commands **Ask Agent About Conversation…** and **Ask Agent About Message…** do
the same for the open channel and the selected message; the web app says "Starting agents needs
the desktop app". Direct messages, groups and encrypted conversations can't be given to agents yet,
so their menus don't offer it, and the commands say "Agents can't be given direct messages or
groups yet." or "Agents can't read encrypted conversations yet."

1. **Choose a session.** RIM lists the sessions that are ready or working, with the agent, the
   title and the folder, and **New session…**, which opens **Start an agent session** and goes on
   once the new session is ready. A session without RIM's tools says "<agent> can't read RIM in
   this session", with the reason; you can still pick it, since the agent may have other ways.
2. **Let it read the channel.** When nothing you let that agent read covers the channel, RIM asks
   "<agent> can't read #channel yet. Let it read #channel?". **Let it read #channel** adds that
   one channel to what the agent can read, as ticking it in **Choose what it can read** does, and
   nothing else. **Not now** adds nothing, and the agent will be refused the channel.
3. **Write your question.** The session opens with "About: #channel" or "About: a message in
   #channel" above the box; × takes it off. Nothing is sent until you press Enter.

The prompt holds your words and a link to the channel or the message, never its messages: the
agent reads them through RIM's tools, under what you let it read, and the record shows what it
was given.

**When the agent is refused a channel.** If an agent in a session asks RIM's tools for a channel
you haven't let it read, the session shows "<agent> asked to read #channel, which it can't read."
with **Let it read #channel**, which asks as above, and **Dismiss**. Each channel is offered once
per session. Only that button grants: no command, and nothing the agent sends, can.

### The reference an agent is given

For tool authors: the prompt carries an ACP `resource_link` block whose `uri` is

```
rim://workspace/<workspaceId>/conversation/<conversationId>
rim://workspace/<workspaceId>/conversation/<conversationId>/message/<messageId>
```

with each id percent-encoded, and whose `name` is "#channel in <workspace>" or "Message in
#channel". A text block after it repeats the ids: "About this RIM conversation: workspace <id>,
conversation <id>, message <id>. Use RIM's tools to read it." The ids are the ones RIM's tools
take: `workspaceId` and `channelId` for `rim_read_messages`, and the message's `id` in what it
returns. RIM doesn't resolve `rim://` links itself; an agent reads them with its RIM tools.

## Choose what it can read

A new agent can read nothing. In **Settings > Agents**, pick the agent, then **Choose what it can
read**:

- tick channels of a workspace one by one, or
- tick **All channels you can see** in a workspace. That includes private channels you're in, and
  channels you join later.

The agent reads these without asking you each time. You can change the choice whenever you like,
and the change applies to its next request.

**What stays closed, always:**

- Direct messages and groups.
- Encrypted conversations.
- Channels and workspaces you haven't chosen.

There is no setting that opens direct messages, groups or encrypted conversations to an agent.

**Workspaces on other servers** can't be chosen yet. Only workspaces on your own server are
offered.

**Where it reads from.** The messages stored on this computer. A channel that isn't stored yet is
refused with a note to try again shortly, and RIM starts storing it. An agent can never read more than
you can: a channel you leave or lose access to closes for it too, within about 30 seconds.

**Text people wrote is marked as untrusted** when RIM hands it to the agent. That makes it harder
for a message to steer the agent. It can't make it impossible.

## When it wants to post

An agent can ask to post a message in a channel you let it read, and nowhere else. RIM then comes
to the front with an approval card:

- the agent's name, "wants to: send a message", and an **Agent outside RIM** label;
- a warning that the request came from a program outside RIM, which may have read text meant to
  steer it;
- the workspace and the channel;
- the whole message, with how many lines and characters it has. Invisible characters and
  characters that change text direction are shown by name, so nothing is hidden.

Read the text before you send it. The agent may have read something meant to steer it.

- **Send** posts it. The button waits one second before it works, so a key press meant for
  something else can't send it.
- **Cancel**, the close button or Escape throw it away. It never leaves your computer.
- If you don't answer within 60 seconds, the card closes and nothing is sent.

After you throw a message away, or let it expire, the same agent can't ask again for 10 seconds.

The message goes out under your name. Other people in the channel aren't told that a program wrote
it. The workspace's audit log records that an agent started it, and the workspace's Owner and
Moderators can read that log.

On a server whose operator switched off AI commands, posting is refused before you're asked.

## RIM commands

An agent can ask to run RIM's own commands, such as pinning a message or setting a channel's
topic, but only the ones you tick. Pick the agent, then **Choose its commands**: the **RIM
commands** section lists, by category, the commands RIM offers agents in the workspaces it can
read. Nothing is ticked at first, and what you approved for the assistant doesn't count here.

RIM offers a command only when the server lets agents call it, the server runs it, and it changes
something. Commands that only move around the app or read are left out: the agent reads through its
read tools. Sending a message has its own request, above. Commands that connect, answer or manage
agents are never offered. Your own macros with **The assistant and agents can run this** ticked are offered
too, under Macro, in the workspaces of your home server, each run as one command
([Macros](commands-and-automation.md#macros)).

- **Every call asks you first**, with an approval card like the one for posting: the agent's
  name, the command, the workspace, the channel when it names one, and every argument in full.
  Nothing is hidden, since the agent chose the values: one that looks like a secret, such as a
  token, shows in full with the note "Looks like a secret". For a macro the card also lists its
  steps, each with the arguments fixed for it. A command the server marks as restricted also asks
  you to type its word.
- **A command marked "Only proposed"** is dangerous. It never runs from an agent: the agent can only
  suggest it, and you run it yourself.
- **It acts only where you let the agent read.** The agent names the workspace and every
  conversation and message itself; RIM never uses what you have open. A workspace it can't read, a
  channel outside its grant, a direct message, a group or an encrypted conversation is refused
  before you're asked. RIM checks the approval and the grant again after you confirm.

Discards, expiries and the 10 seconds after them work as they do for posting. On a server whose
operator switched off AI commands, RIM commands are refused before you're asked.

## Plugin commands

An agent can also run commands of your plugins, but only the ones you tick. Pick the agent, then
**Choose its commands**. Nothing is ticked at first, and what you approved for the assistant
doesn't count here.

- **A command its plugin marks as read-only** runs without asking. That mark is the plugin's own
  claim, and RIM can't check it.
- **Any other command** you ticked shows an approval card first, like the one for posting, with
  every argument in full, including any that looks like a secret, which carries a note saying so.
- **A dangerous command** never runs from an agent. The agent can only suggest it, and you run it
  yourself.

A plugin can read whatever its own permissions allow. A plugin allowed to read conversations can
read every one you can and hand it to the agent, whatever channels you chose above. Encrypted
conversations take a separate permission. The screen warns you when a plugin has either. When a
plugin changes, its ticks stop working until you choose again.

## See what it was given

Each agent's page in **Settings > Agents** lists the channels it read, how many messages, and when.
Two buttons show more:

- **What it was given**: every request, with the time, the tool, the channel, the message ids,
  what it asked to post or run, RIM's or a plugin's command, and how that ended, and what RIM
  refused. It never holds message
  text, search text, or a command's arguments or results.
- **Its runs**: the same record, grouped. A run is that agent's requests with no more than 15
  minutes between them. It's a grouping by time: RIM can't see where the agent's task starts or
  ends, or what it does between requests.

**What agents were given** and **All runs**, under the list, show the same for every agent,
including ones you disconnected. Home can show the newest runs too, in the **Your agents' runs**
box ([Home](home.md)).

The record stays on this computer for 30 days. **Clear the whole record** empties it for every
agent and leaves one line saying you did.

A channel's header says "your agent can read this" when one of your agents may read that channel.

## Disconnect it

Pick the agent in **Settings > Agents** and choose **Disconnect**. From then on it can't reach RIM.

Disconnecting can't take anything back. What the agent already read stays with it.

Removing RIM from Claude Code, or the setup from any other tool, doesn't end its access, and neither does connecting it again: the
older entry keeps working. **Disconnect** in RIM is what ends it.

## What RIM can't promise

- **Where the content goes after RIM hands it over.** What an agent reads goes to its model. A
  model on your computer keeps it there, and a cloud provider receives it. RIM can't see or limit
  that step.
- **Protection from harmful programs.** Connecting stops an ordinary program reaching RIM by
  accident. It isn't a wall against malware: another program running as you can do what you can.
  Connect only programs you trust.
- **That a modified app follows these rules.** The desktop app enforces them. Your server doesn't
  know about agents, their channels or their record.

The rules RIM follows are written down in rim-server's
[agent data flow contract](../../rim-server/docs/specs/agent-data-flow-v1.md). The
[agents section of The assistant](ai-agent.md#agents-that-connect-to-rim) has every detail of the
screens.

## Next

- [The assistant](ai-agent.md): the assistant built into the desktop app.
- [Plugins](plugins.md): installing and trusting plugins.
- [Post alerts from other services](webhooks.md): webhooks, for services that post on their own.
