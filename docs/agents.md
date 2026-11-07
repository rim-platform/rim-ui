# Connect an AI agent

An outside agent is a program on your computer that works with its own AI model, such as Claude
Code. You can connect it to the RIM desktop app, choose which channels it may read, and approve
each message before it posts. This page shows how. It is for the person using RIM.

RIM also has an agent of its own, built into the desktop app, that runs with your API key. That
one is [The AI agent](ai-agent.md). The two are separate: what you allow one doesn't carry over to
the other.

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

RIM ships a plugin for Claude Code. Install it once:

```sh
claude plugin marketplace add rim-platform/rim-ui
claude plugin install rim@rim-platform
```

Then:

1. In Claude Code, say "connect to RIM".
2. Claude Code shows a code. RIM comes to the front and shows a dialog with a code too.
3. Check that the two codes are the same. Then choose **The code matches, connect**.
4. Restart Claude Code, or run `/mcp` in it.

If the codes differ, or you didn't ask for this, choose **Don't connect**. Closing the dialog or
pressing Escape also refuses. A request nobody answers ends after two minutes.

The name in the dialog is what the program calls itself. RIM can't check it, so the code is what
tells you it's the program you started.

Claude Code keeps its token in `~/.claude.json`, which any program running as you can read. The
[plugin's README](../integrations/claude-code/README.md) has the details.

**Other agents.** Any program that speaks the Model Context Protocol over HTTP can connect the same
way, but RIM has a ready-made setup only for Claude Code. The plugin's `scripts/pair.sh` shows the
steps.

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

## Plugin commands

An agent can also run commands of your plugins, but only the ones you tick. Pick the agent, then
**Choose its plugin commands**. Nothing is ticked at first, and what you approved for the built-in
agent doesn't count here.

- **A command its plugin marks as read-only** runs without asking. That mark is the plugin's own
  claim, and RIM can't check it.
- **Any other command** you ticked shows an approval card first, like the one for posting, with
  every argument in full. Values that look like secrets are hidden.
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
  what it asked to post or run and how that ended, and what RIM refused. It never holds message
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

Removing RIM from Claude Code doesn't end its access, and neither does connecting it again: the
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
[agents section of The AI agent](ai-agent.md#agents-on-this-computer) has every detail of the
screens.

## Next

- [The AI agent](ai-agent.md): the agent built into the desktop app.
- [Plugins](plugins.md): installing and trusting plugins.
- [Post alerts from other services](webhooks.md): webhooks, for services that post on their own.
