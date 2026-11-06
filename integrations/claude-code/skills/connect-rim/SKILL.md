---
name: connect-rim
description: Connect Claude Code to the RIM desktop app on this computer, or disconnect it. Use when the person asks to connect to, set up, or disconnect RIM.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh *)
---

# Connect to RIM

The script prints one line per run, `KEY` or `KEY: text`.

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh start`. If it prints `ALREADY_CONNECTED`, ask whether to
   replace it, and if the answer is yes, run `${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh start --replace`.
   Any other line that does not start with `CODE` is shown to the person, and you stop.
2. On `CODE`, tell the person: RIM will show a dialog. Check that it shows this same code, and only
   then approve. Never pick the answer for them. Show the code as printed.
3. Run `${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh wait`. While it prints `PENDING`, run it again. Any
   other line is the result: tell the person what it says.
4. To disconnect, run `${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh disconnect` and show its line. To check
   whether RIM is set up, run `${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh status`.
5. Never read, print or ask for a token. Never run `claude mcp get`, which prints it, and never read
   `~/.claude.json`, `~/.claude/backups` or the script's state directory. Do not run `curl` against
   RIM yourself.
6. After connecting, say that the agent can read nothing until the person chooses what in RIM's
   Settings > Agents, and that what it reads goes to its model provider. Do not tell them this makes
   anything private.
