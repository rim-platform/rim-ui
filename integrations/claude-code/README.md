# RIM for Claude Code

A Claude Code plugin that connects Claude Code to the RIM desktop app on this computer. It adds RIM as
an MCP server, after you compare a code and approve in the app.

## Install

Claude Code fetches the plugin from GitHub itself, so there is nothing to clone or download by
hand. In a terminal, not in Claude Code's chat, run:

```sh
claude plugin marketplace add rim-platform/rim-ui --sparse .claude-plugin integrations/claude-code
claude plugin install rim@rim-platform
```

- `rim-platform/rim-ui` is this repository on GitHub. The full address,
  `https://github.com/rim-platform/rim-ui.git`, works the same.
- `--sparse` checks out only `.claude-plugin` and this folder, not the whole app.
- Claude Code reads the default branch. To stay on one release, add `#` and its tag after the
  repository, as in `rim-platform/rim-ui#<tag>`.
- From a local checkout, for a build from source or before a release:
  `claude plugin marketplace add /path/to/rim-ui`. `--sparse` doesn't apply to a folder.

## Connect

1. In the RIM desktop app, open **Settings > Agents** and turn on **Let agents on this computer
   connect**.
2. In Claude Code's chat, type "connect to RIM".
3. Claude Code shows a code. RIM shows a dialog with the same code. Check that they match, then
   choose **The code matches, connect**.
4. Restart Claude Code, or type `/mcp` in its chat.

## Disconnect

Say "disconnect RIM" in Claude Code, or run `scripts/pair.sh disconnect`. Then press **Disconnect**
in RIM's **Settings > Agents**.

## What to know

- The token is stored by Claude Code in `~/.claude.json`, readable by any program running as you.
  That is the same limit the app's own dialog states. `claude mcp get rim` prints it, and Claude Code
  keeps copies in `~/.claude/backups`, which stay after RIM is removed from Claude Code.
- Removing RIM from Claude Code does not end its access, and neither does connecting again, which
  leaves the older entry working. **Disconnect** in RIM does. Each entry there shows when it connected.
- This works with the desktop app only, and needs **Settings > Agents** on.
- The script never prints the token or the poll secret, because what a command prints goes to the
  model and its provider.
