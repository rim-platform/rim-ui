/** The ready-made setup for each MCP tool a person can connect to RIM with a token. */

/** A tool RIM has ready-made setup for, and the generic entry for any other. */
export interface ToolSetup {
  id: string;
  /** The tab's label. */
  label: string;
  /** Where the snippet goes, as the person reads it. */
  where: string;
  /** The snippet, with the address and the token filled in. */
  snippet: (address: string, token: string) => string;
}

/** The JSON of `value`, indented by two spaces. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** The setup of each tool, in the order the tabs show them. */
export const TOOL_SETUPS: readonly ToolSetup[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    where:
      "Run this in a terminal. Claude Code saves it for your user in ~/.claude.json, so it works in every folder.",
    snippet: (address, token) =>
      `claude mcp add --transport http --scope user rim ${address} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "codex",
    label: "Codex",
    where: "Add this to ~/.codex/config.toml.",
    snippet: (address, token) =>
      [
        "[mcp_servers.rim]",
        `url = "${address}"`,
        `http_headers = { Authorization = "Bearer ${token}" }`,
      ].join("\n"),
  },
  {
    id: "opencode",
    label: "opencode",
    where: "Add this to ~/.config/opencode/opencode.json, merged with what is already there.",
    snippet: (address, token) =>
      json({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          rim: {
            type: "remote",
            url: address,
            enabled: true,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }),
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    where: "Add this to ~/.gemini/settings.json, merged with what is already there.",
    snippet: (address, token) =>
      json({
        mcpServers: { rim: { httpUrl: address, headers: { Authorization: `Bearer ${token}` } } },
      }),
  },
  {
    id: "cursor",
    label: "Cursor",
    where: "Add this to ~/.cursor/mcp.json, merged with what is already there.",
    snippet: (address, token) =>
      json({
        mcpServers: { rim: { url: address, headers: { Authorization: `Bearer ${token}` } } },
      }),
  },
  {
    id: "vscode",
    label: "VS Code",
    where:
      "Add this to your user mcp.json: in VS Code, run MCP: Open User Configuration. Not a project's .vscode/mcp.json, which others may see.",
    snippet: (address, token) =>
      json({
        servers: {
          rim: { type: "http", url: address, headers: { Authorization: `Bearer ${token}` } },
        },
      }),
  },
  {
    id: "generic",
    label: "Generic",
    where:
      "Any MCP client that speaks streamable HTTP: give it this address, and have it send this header with every request.",
    snippet: (address, token) => `${address}\nAuthorization: Bearer ${token}`,
  },
];
