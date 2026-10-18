# The plugin manifest

Every plugin carries `rim-plugin.json` at the root of its folder or bundle. This page lists each
field the desktop parser accepts, in the order of `PluginManifest` in `manifest.rs`, with the
install rules of `validation.rs`, both in `src-tauri/src/plugin_host/`. The web app installs by
their port in the SDK, `manifestRules.ts`; both pass `protocol/manifest-vectors.json`, and a
plugin's tests run them with `validateManifest` ([the SDK](../sdk/plugin-sdk/README.md)).

## Reading and checking

- The file is JSON with snake_case keys. Unknown fields are ignored and left out of the hash.
- A field with a default may be left out, but `null` is refused for it. `author`,
  `network_origins`, `output_schema`, `preset_args` and `slot` take `null` as absent.
- A folder or repository without `rim-plugin.json` at its root fails to install with `no
  rim-plugin.json found in the plugin folder; every plugin needs one at its root` (local folder)
  or `no rim-plugin.json found at the root of the repository; every plugin needs one` (git).
- A missing field or a wrong type fails with `failed to parse manifest: <reason>`, the manifest's
  own checks with `validation error: <reason>`, the install checks with `invalid manifest:
  <reason>` and, in the UI, `{ kind: "INVALID_MANIFEST", message, data }` with `data.kind` one of
  the tags below. The first failing check is reported. The desktop repeats the checks at every
  start and skips a plugin that fails them.

## Identity and runtime

- **`manifest_version`** (integer, required): `1`; anything else fails with
  `unsupported manifest_version: <n>`.
- **`plugin_id`** (string, required): a reverse-domain id such as `dev.example.greeter`, at least
  three dot-separated segments of ASCII letters, digits and `-` (`plugin_id must have at least 3
  segments`, `contains an empty segment`, `segment contains invalid characters`). Ids
  starting `dev.rim.` or `com.rim.` fail with `reserved plugin_id prefix: <id>`. The id names the
  install folder, `~/.rim/plugins/<plugin_id>/`, and every command, `plugin.<plugin_id>.<id>`.
- **`display_name`** (string, required, not empty): the name in Settings, in the permission
  prompt, as the palette category of the plugin's commands and in the side rail's Plugins menu.
- **`version`** (string, required, not empty): free-form. The bundler names its file
  `<plugin_id>-<version>.rimbundle`.
- **`description`** (string, required, may be empty) and **`author`** (string or `null`, default
  `null`): the permission prompt quotes the first, cut at 600 characters, and says "by <author>".
- **`runtime_kind`** (string, required): another value fails with `unknown variant`.
  - `"DesktopLocalProcess"`: a program the desktop app starts, speaking protocol v1 over stdio.
    It runs as the user; capabilities govern only what the host does for it.
  - `"WebSandboxed"`: one ES module in a sandboxed iframe, on the desktop and the web, reaching
    only what its capabilities and `network_origins` allow ([web plugins](web-plugins.md)).
- **`entrypoint`** (string, required, not empty):
  - `DesktopLocalProcess`: a file in the plugin folder that the host runs directly, with no
    arguments and the plugin folder as working directory, so it needs a `#!` line and the
    executable bit. A missing file fails at start with `entrypoint not found`.
  - `WebSandboxed`: a bundle path (`/`-separated segments of `A-Z a-z 0-9 . _ -`, none empty or
    starting with `.`, at most 255 bytes) ending in `.mjs` or `.js` and not under `panels/`.
    Otherwise `INVALID_ENTRYPOINT`: ``invalid entrypoint `<path>`: <reason>``.

## `capabilities`

A list of strings, default `[]`: the permissions the plugin asks for, in a prompt shown after
install and from Settings → Plugins → Permissions. Revoking any capability stops the plugin.

| Name | Kinds | What it guards |
|---|---|---|
| `ui.panel` | both | `rim.ui.update_panel`: the panel state `host.panels` sets |
| `ui.notify` | both | Notifications a panel shows with `rim.ui.notification.show` |
| `chat.read` | both | `rim.chat.list_messages`, `get_message`, `search_messages` |
| `chat.write` | both | `rim.chat.post_message` |
| `chat.read.encrypted` | both | The reads in encrypted DMs and groups; needs `chat.read` |
| `chat.write.encrypted` | both | Posting in encrypted DMs and groups; needs `chat.write` |
| `network.fetch` | `WebSandboxed` | Connecting to the origins in `network_origins` |

These are the only names. A key fails with `INVALID_CAPABILITY_KEY` (``invalid capability key
`<key>`: <reason>``) when:

- it is `network.fetch` on a `DesktopLocalProcess` plugin, or `local.process`, `fs.read`,
  `fs.write` or `network` on a `WebSandboxed` one, with the reason the kind cannot hold it;
- it starts with `plugin.`: plugin-scoped keys such as `plugin.<plugin_id>.<verb>` are refused,
  since the permission prompt lists only the names above and could never approve one
  (``plugin-scoped capability keys are not supported, since the permission prompt cannot approve
  them; a manifest names only built-in capabilities: <names>``);
- it is any other name not in the table, such as `events.read`, `local.process`, `network` and
  `fs.*` on a local process, which guard nothing the host implements (``not a built-in
  capability; a manifest names only built-in capabilities: <names>``);
- it is an encrypted chat name without its plain one (`chat.read.encrypted requires chat.read`).

`<names>` lists the table's names the plugin's kind may hold.

## `network_origins`

A list of strings, absent by default, for `WebSandboxed` only: the origins the plugin's frame may
connect to once `network.fetch` is approved. The prompt names each host. It fails with
`INVALID_NETWORK_ORIGINS` (`invalid network_origins: <reason>`) when:

- it is present on a `DesktopLocalProcess` plugin or without `network.fetch`, absent while
  `network.fetch` is declared, lists fewer than 1 or more than 16 origins, or one twice;
- an entry is not `https://host[:port]` or `wss://host[:port]` with a lowercase host and no path,
  trailing slash, query, fragment, userinfo or wildcard, or its port is empty, starts with `0` or
  exceeds 65535;
- an entry has the host and port of the app's or the RIM API's own origin, default ports aside.

## `commands`

A list, default `[]`. Each entry joins the shared command registry as `plugin.<plugin_id>.<id>`:
the palette, keybinds, macros and, when allowed, the AI agent.

- **`id`**, **`title`**, **`description`** (strings, required): the key in the SDK's `commands`,
  the palette's line and its detail.
- **`keybind_capable`** (bool, default `false`): offered when binding a key.
- **`dangerous`** (bool, default `false`): the user confirms every run, the agent only proposes it.
- **`required_context`** (strings, default `[]`): `"conversation"`, `"message"` or `"workspace"`.
  It runs only there, with `conversation_id` and `thread_id`, `message_id`, `conversation_id` and
  `thread_id`, or `workspace_id` added to `args`; an argument of one of those names fails with
  `RESERVED_ARGUMENT`. Other values are not checked.
- **`required_capabilities`** (strings, default `[]`): capabilities approved before the command
  runs, or it fails with `CAPABILITY_DENIED`. Each must be a name `capabilities` may hold, or
  `INVALID_CAPABILITY_KEY` with ``required by command `<id>`: `` before the reason, and one
  `capabilities` declares, or `UNDECLARED_CAPABILITY`: ``command `<id>` requires capability
  `<key>`, which the manifest's capabilities do not declare``.
- **`arguments`** (list, default `[]`): by convention objects with `name`, `type`, `required` and
  `description`. The palette and keybinds pass no arguments, so they leave out a command with a
  `required` one. The agent's tool schema takes `description`, and `type` when it is `string`,
  `integer`, `number`, `boolean`, `object` or `array`.
- **`ai_callable`** (bool, default `false`): offers the command to the agent once the user allows
  it in the plugin's AI access settings. The tool name `plugin__<plugin_id, dots as _>__<id>` must
  match `[A-Za-z0-9_-]{1,64}`, or the command is not offered.
- **`output_schema`** (JSON or `null`, default `null`): the JSON Schema of the payload. An
  `ai_callable` command fails with `REQUIRES_MANUAL_REVIEW`, and does not install, without one or
  when its root is not `"type": "object"`, sets `"additionalProperties": true`, or has neither
  `properties` nor `oneOf`, `anyOf`, `allOf`, `$defs` or `items`. In `properties`, `items`, the
  combinators and `$defs`, a name whose letters and digits, lowercased, contain `installid` or
  `installationid` fails with `INSTALL_ID_LEAK`: a per-install id would let the model link one
  person across workspaces.

## `keybind_suggestions` and `context_actions`

`keybind_suggestions` (default `[]`) are keys the desktop lists in the keybind settings until the
command is bound; it binds nothing itself. Each has `keystroke` (such as `Ctrl+Alt+P`),
`command_id` (a command of this manifest, unqualified) and `context` (`GLOBAL`, `COMPOSER`,
`MESSAGE_LIST`, `THREAD_VIEW`, `CONVERSATION_VIEW`, `PANEL` or `COMMAND_PALETTE`; empty means
`GLOBAL`), all required strings, and `preset_args` (optional JSON, unused by the app). An unknown
command fails with `keybind_suggestion references undeclared command: '<id>'`.

`context_actions` (default `[]`) are entries of a message's context menu. Each has `id`, `title`
(the label) and `command_id`, required strings, and `context_types` (default `[]`): empty shows
the entry on every message, otherwise it shows when the list holds `"message"`. An unknown command
fails with `context_action '<id>' references undeclared command: '<command_id>'`.

## `panels`

A list, default `[]`. A panel is the folder `panels/<id>/` with an `index.html`, shown in a
sandboxed frame while its plugin runs ([loading](web-plugins.md#how-a-plugin-runs)).

- **`id`** (string, required): the folder's name; for `WebSandboxed`, one bundle path segment,
  or `INVALID_PANEL`.
- **`title`** (string, required) and **`description`** (string, default `""`): the title names
  the panel's row in the side rail's Plugins menu, beside the plugin's name, and the palette
  command "Open <title>".
- **`slot`** (string or `null`, optional): `"tool_panel"`, the default, is a narrow column beside
  the tool panel, next to the conversation; `"main_area"` takes the main area in place of the
  conversation. Panels show while a conversation is the main surface. Other values fail to parse.

## `settings_schema`

A list, default `[]`, with one entry per setting the user fills in. A plugin with at least one
gets a **Settings** button on its row in Settings → Plugins, which opens a form built from the
list ([Using a plugin](plugins.md#using-a-plugin)). An entry that breaks a rule below fails
install with `INVALID_SETTINGS_SCHEMA`, `invalid settings_schema[<index>] \`<key>\`: <reason>`.

| Field | Type | Rule |
|---|---|---|
| `key` | string, required | 1 to 128 characters of `A-Z a-z 0-9 . _ -`, unique in the manifest: the setting's name in the values the plugin reads |
| `title` | string, required | Not empty: the field's label |
| `description` | string, default `""` | The help line under the field |
| `value_type` | string, required | `string`, `boolean`, `integer`, `path` or `enum` |
| `is_secret` | boolean, default `false` | Only with `string`. The value goes in the desktop's [secret vault](secret-vault.md) and is never shown again once saved |
| `default` | optional | The value the plugin gets while the user has saved none: of the setting's type, within `min` and `max`, one of `options`. Not with `is_secret` |
| `min`, `max` | integer, optional | `integer` only: inclusive bounds, `min` at most `max` |
| `options` | list of strings, optional | Required for `enum` and allowed only there: at least one, no duplicates |
| `placeholder` | string, optional | `string`, `path` and `integer` only: the hint an empty field shows |

| `value_type` | The value | The form shows |
|---|---|---|
| `string` | A JSON string | A text field; a masked one with **Replace** and **Clear** when `is_secret` |
| `path` | A JSON string | A text field for a path on the device, which the host neither opens nor checks |
| `integer` | A JSON integer from -(2^53 - 1) to 2^53 - 1, within `min` and `max`; the same bound holds for `min`, `max` and `default` | A number field |
| `boolean` | `true` or `false` | A switch |
| `enum` | One of `options` | A list to pick from, with "Not set" |

The values are kept on the device per plugin, signed-in account and device, never synced and
deleted on uninstall; the web app keeps no secret settings and its form says they are only
available in the desktop app. A save is checked against the schema and refused with the field
that is wrong. An update that changes the schema leaves saved values as they are, so a plugin
checks each value it uses and ignores keys it does not know. The plugin reads the values with
`rim.settings.get` and hears every change in `rim.settings.changed`; with the SDK, that is
`host.settings.get()` and `onSettingsChanged` ([the SDK's README](../sdk/plugin-sdk/README.md)).

```json
"settings_schema": [
  { "key": "context", "title": "Kubernetes context", "description": "The kubectl context to use. Empty for the current one.", "value_type": "string", "placeholder": "prod-eu" },
  { "key": "namespace", "title": "Default namespace", "value_type": "string", "default": "default" },
  { "key": "refresh_seconds", "title": "Refresh every (seconds)", "value_type": "integer", "default": 30, "min": 5, "max": 3600 },
  { "key": "output", "title": "Output", "value_type": "enum", "options": ["table", "json"], "default": "table" },
  { "key": "api_token", "title": "API server token", "value_type": "string", "is_secret": true }
]
```

## The content hash

The desktop records a hash of the manifest at install and when the user approves AI commands: the
SHA-256, in lowercase hex, of the parsed manifest serialized as compact JSON, with the fields in
the order above, defaults filled in and unknown fields gone. Whitespace, key order and spelled-out
defaults do not change it. `network_origins`, a panel's `slot` and a setting's `default`, `min`,
`max`, `options` and `placeholder` are left out when absent, so a manifest without them hashes as
on a host without those fields; other absent options are `null`.

It gates AI consent. When the hash differs from the recorded one and the manifest declares
`ai_callable` commands, or the user approved some, the agent runs none of the plugin's commands
until the user consents again (`manifest changed — re-consent required for AI commands`). Any
change counts, since the old command set cannot be read from a hash: adding, removing or changing
a `settings_schema` entry asks for AI consent again too.

## Example

The manifest of [`plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs), a web
plugin with a network permission, a tool panel and a secret setting, verbatim:

```json
{
  "manifest_version": 1,
  "plugin_id": "chat.rim.github-prs",
  "display_name": "GitHub Pull Requests",
  "version": "0.0.1",
  "author": "RIM team",
  "runtime_kind": "WebSandboxed",
  "entrypoint": "main.mjs",
  "description": "Lists the open pull requests of the GitHub repositories you choose. Talks only to GitHub, with your own token if you add one in its settings.",
  "capabilities": ["ui.panel", "network.fetch"],
  "network_origins": ["https://api.github.com", "https://avatars.githubusercontent.com"],
  "commands": [
    {
      "id": "refresh",
      "title": "Pull requests: Refresh",
      "description": "Fetches the open pull requests again.",
      "keybind_capable": true
    },
    {
      "id": "add_repo",
      "title": "Pull requests: Add repository",
      "description": "Adds a GitHub repository to the list, at most 10.",
      "arguments": [
        {
          "name": "repo",
          "type": "string",
          "required": true,
          "description": "The repository as owner/name, such as rust-lang/rust."
        }
      ]
    },
    {
      "id": "remove_repo",
      "title": "Pull requests: Remove repository",
      "description": "Removes a repository from the list.",
      "arguments": [
        {
          "name": "repo",
          "type": "string",
          "required": true,
          "description": "The repository as owner/name."
        }
      ]
    }
  ],
  "panels": [
    {
      "id": "prs",
      "title": "Pull requests",
      "description": "Open pull requests of the repositories on your list.",
      "slot": "tool_panel"
    }
  ],
  "settings_schema": [
    {
      "key": "github_token",
      "title": "GitHub token",
      "description": "Optional, desktop app only. A fine-grained personal access token with Public repositories (read-only) access and an expiry date raises GitHub's limit from 60 to 5,000 requests an hour. Kept in this device's encrypted secret vault, never synced, sent only to api.github.com.",
      "value_type": "string",
      "is_secret": true,
      "placeholder": "github_pat_…"
    }
  ]
}
```
