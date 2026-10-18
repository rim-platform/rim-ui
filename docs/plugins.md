# Plugins

A plugin adds commands, panels and keybinds to RIM. This page is for the person using the app:
what a plugin can do, the official plugins, and how to install, use, trust and remove one. How
the client hosts plugins is in [Web plugins](web-plugins.md) and
[Workspace plugins](workspace-plugins.md); the model behind both is rim-server's
[plugin model](../../rim-server/docs/plugin_model.md).

## What a plugin is

A plugin runs in the client, beside the app, never on the server. It acts for the user: it
reaches RIM only through the app, which uses the user's own session, and a plugin that runs on
the computer uses the user's own local credentials. There are two kinds, and Settings names
each in a few words:

- **Sandboxed** (`WebSandboxed`) runs in a sandboxed frame of the app, in the web app and the
  desktop app alike. It cannot read files, run programs or use the RIM session. It reaches RIM
  only through the permissions it was granted, and the network only at the sites its manifest
  lists, once allowed.
- **Runs on this computer** (`DesktopLocalProcess`) is a program the desktop app starts. It runs
  as the user, with the user's access to files, the network and local credentials such as a
  kubeconfig. Its permissions govern what the app does for it, not what the program can do on
  the machine. The web app does not run this kind and lists it as "Needs the desktop app"; the
  [local plugin host](../../rim-server/docs/local_plugin_host.md) describes how the desktop
  runs it.

A plugin contributes some of these:

- commands, listed in the command palette under the plugin's name, bindable to keys and, when
  the plugin marks them so and the user agrees, callable by the AI agent;
- panels, shown next to the tool panel or in place of the conversation;
- context actions in a message's context menu;
- keybind suggestions the user can assign.

Without the matching permission the app does not show a plugin's panel, read or post messages
for it, or show its notifications, and a sandboxed plugin cannot reach any site. A command the
plugin marks dangerous runs only after the user confirms that run: the AI agent can never
confirm one, and a plugin's panel cannot confirm one for its own plugin.

## The official plugins

The project publishes four plugins, each in its own repository, all at version 0.0.x. Each
README lists the plugin's commands and the ways to install it.

| Plugin | What it does | Kind | Permissions it asks for | Repository |
|---|---|---|---|---|
| Poll | Runs a quick poll in the open conversation; the poll and every vote are messages | Sandboxed | `ui.panel`, `chat.read`, `chat.write`; optionally `chat.read.encrypted` and `chat.write.encrypted` | [plugin-poll](https://github.com/rim-platform/plugin-poll) |
| GitHub Pull Requests | Lists the open pull requests of up to 10 public GitHub repositories | Sandboxed | `ui.panel`, `network.fetch` for `api.github.com` and `avatars.githubusercontent.com` | [plugin-github-prs](https://github.com/rim-platform/plugin-github-prs) |
| Kubernetes Pods | Lists a namespace's pods, shows and follows a container's logs, restarts a pod after you confirm | Runs on this computer | `ui.panel`, `ui.notify` | [plugin-k8s-pods](https://github.com/rim-platform/plugin-k8s-pods) |
| Releases | Watches the GitHub releases of up to 10 public repositories and posts them into a conversation when asked | Sandboxed | `ui.panel`, `network.fetch` for `api.github.com`, `chat.write` | [plugin-releases](https://github.com/rim-platform/plugin-releases) |

- **Poll** needs the two encrypted permissions to work in encrypted DMs and groups; without them
  it works in plaintext channels only. On the web it reads messages only in a browser set up as
  a [linked device](web-linked-device.md).
- **GitHub Pull Requests** and **Releases** use no token, so they see public repositories only.
  GitHub allows 60 requests an hour per IP address without one.
- **Kubernetes Pods** needs the desktop app, Node.js 22 or newer and `kubectl`, which it runs
  with your own kubeconfig. Four of its commands can be called by the AI agent once approved in
  Settings → Plugin AI; **Pods: Restart pod** is dangerous, so it runs only after you confirm,
  also when the agent asks for it. It suggests <kbd>Ctrl+Alt+P</kbd> for **Pods: Refresh**.

## Installing

Settings → Plugins has three install buttons.

- **Install from local folder** (desktop) opens a folder picker. The app copies the plugin from
  the chosen folder into its plugins folder; for a sandboxed plugin it copies only the bundle's
  files.
- **Install from git URL** (desktop) takes an `https://`, `ssh://` or `user@host:owner/repo`
  URL, then **Install**. For a sandboxed plugin the app keeps only `rim-plugin.json`, the entry
  module and `panels/` from the checkout. For a plugin that runs on this computer, a
  `package.json` that declares dependencies or a `requirements.txt` means install steps. Before
  any of them runs, the **Run plugin install scripts?** dialog lists each command exactly as it
  will run (`npm install --production`, `pip install -r requirements.txt --user`), with its
  folder, and warns that it runs the author's code with your privileges, outside the
  permissions you approve later. **Run commands and install** continues; **Cancel** installs
  nothing.
- **Install from link** (desktop and web) takes a link of the form
  `https://<host>/<name>.rimbundle#sha256=<hash>`, then **Install**. The bundle is fetched
  without credentials, must hash to the value after `#sha256=` and must pass the manifest rules
  before anything is installed. The desktop app fetches the link itself, so a link to a GitHub
  release asset installs; it follows redirects only to other `https://` links and stops reading
  past 8 MiB. The web app fetches from the browser, so there the bundle's host must allow
  cross-origin requests ([web plugins](web-plugins.md#installing-from-a-link)). A link to a
  plugin already installed opens **Replace \<name\>?**, which shows the version change and the
  permissions added or dropped; the permissions are approved again afterwards.

Each way installs only what passes the manifest rules ([the plugin manifest](plugin-manifest.md)),
and the error names what failed:

- A folder or repository without `rim-plugin.json` at its root: "no rim-plugin.json found in the
  plugin folder; every plugin needs one at its root", or "… at the root of the repository".
- A capability that is not one of the names in the table under
  [Trust and permissions](#trust-and-permissions), such as a plugin-scoped
  `plugin.<plugin_id>.<verb>` key: "invalid capability key `<key>`: …".
- A command that requires a capability the manifest does not ask for: "command `<id>` requires
  capability `<key>`, which the manifest's capabilities do not declare".

Every install ends in the **Plugin Permissions** dialog, described under
[Trust and permissions](#trust-and-permissions). After an install its button reads **Approve and
turn on**: approving grants the checked permissions and starts the plugin. **Cancel** leaves it
installed and turned off, to turn on later with the switch on its row. If the plugin does not
start, the dialog says why and its permissions stay saved.

### Workspace registry

Each workspace keeps a registry of plugins it recommends or requires, managed by its Owners and
Moderators. An entry pins one exact version through a statement its publisher signed with their
identity key. Every client verifies that statement against the publisher's key log before it
offers the plugin, so the server is not trusted for what the plugin is, and checks a bundle's
size and SHA-256 before asking for any consent. A bundle an entry keeps on another host, such
as a GitHub release asset, is fetched by the desktop app itself, as **Install from link** does;
the web app needs that host to allow cross-origin requests. An instance can switch the registry
off.
[Workspace plugins](workspace-plugins.md) has the details.

- **The palette's "Workspace plugins" section** lists the entries this device has not
  installed, as `Install <name>` with a line such as
  `Recommended by Acme · signed by Ada (rimp1_txDLbnip)`. An entry installed at another version
  shows as `Update <name>`, one installed from another workspace as
  `Switch <name> to <workspace>'s version`, and an unsigned copy of the same plugin as
  `Replace <name> with <workspace>'s signed version`. An entry this device cannot install shows
  the reason, such as "Needs the desktop app" or "Signature does not verify", and cannot be
  chosen.
- **Required plugins** are offered when the workspace opens, in **\<workspace\> requires
  plugins**, with **Review and install** for each. **Not now** hides the dialog until the entry
  is signed again. Settings → Plugins also lists them under **\<workspace\>'s plugins**, with
  **Review**.
- **The install dialog** shows the version, the publisher's badge, the status, the source, the
  kind of plugin and whether the bundle matches its signature. **Install** is followed by the
  permission prompt; a git source's install steps ask for consent as above.

On workspace open, and whenever the registry changes, each plugin installed from it is compared
with its entry. A new version installs on its own, with the notice "Updated \<name\> to
\<version\>", when it keeps the kind and the publisher, asks for no new permission and adds no
new command the AI agent can run; the approvals carry over. Anything else waits behind
**Update \<name\>?**, which lists what is new: another publisher, another kind, new permissions,
new commands the AI agent can run, or install steps. **Review update** opens the install
dialog; **Later** keeps the installed version running. A failed update keeps the old copy.

When an entry leaves the registry, its plugin is stopped and **\<name\> was removed** offers
**Remove**, which uninstalls it and deletes its data, or **Keep**, which leaves it installed,
turned off, as a local plugin that no longer gets updates.

## Updating

How a plugin gets a new version depends on where it came from, which its row in Settings →
Plugins names.

- **From git** (desktop). **Update** on the plugin's row fetches the repository it was installed
  from and moves the plugin to the newest commit of its branch. The new copy must keep the
  plugin id and pass the same manifest rules as an install, or the old copy stays. Install steps
  the new version needs open **Run plugin install scripts?** first, as at install, and
  **Cancel** changes nothing. The row then says "Updated to v\<version\>", "Already up to date
  (v\<version\>)", or why the update failed. A running plugin restarts on the new files.
  Approvals carry over for the permissions the new version still asks for and are dropped for
  those it no longer does; a new permission opens the **Plugin Permissions** dialog, and the
  plugin cannot use it until it is approved. A plugin with commands the AI agent can run asks
  for that consent again in Settings → Plugin AI.
- **From a link.** A link names one bundle by its hash, so it cannot change, and the row says
  "Installed from a link pinned to one bundle: install the new version's link to update it."
  Installing that link opens **Replace \<name\>?**, described under [Installing](#installing).
- **From a folder.** There is no update in place: uninstall the plugin, which deletes its
  permissions and data, then install the new folder.
- **From the workspace registry.** The registry updates the plugin as its entry changes, as
  [Workspace registry](#workspace-registry) describes; the row has no **Update**.

## Using a plugin

- **Reading what it is.** A plugin's row in Settings → Plugins shows its name, version, author
  and state (Running, Stopped, Crashed or Timed out), the first two lines of its description,
  and chips for its kind, its signature and where it came from. Beside them are **Update** (a
  plugin from git), **Settings** (a plugin that declares settings), the switch, and **⋯**, a
  menu with **Permissions**, **Activity**, **Sign and publish…** (where offered) and
  **Uninstall…**. **View details** under the description opens a dialog named after the plugin with the whole
  description under "From the plugin author:", shown as the author wrote it, as plain text
  with no formatting or links; its id, version, author, kind, source (the git repository, the
  link with its SHA-256, the workspace registry, or a folder) and signature; each permission
  it asks for, marked Granted or Not granted; the sites `network.fetch` may reach; and its
  commands with their descriptions, a dangerous one marked Dangerous.
- **Settings.** A plugin that declares settings has **Settings** on its row in Settings →
  Plugins, and while it is on, a row named after it with "Settings" in the side rail's
  **Plugins** menu. Both open **\<plugin\> settings**, a form with a field per setting: a text
  field, a number field, a switch or a list, each with its description under it. **Save**
  checks every changed field and names the one that is wrong, **Cancel** closes without saving,
  and **Reset to defaults** clears every saved value, secret ones included, after asking. A
  secret field says only "Configured" once saved, with **Replace** and **Clear**; the value is
  never shown again. In the web app a secret field says it is only available in the desktop
  app. Values are kept for your account on this device and never synced; emptying a field
  clears its saved value, so the plugin falls back to the setting's default. A running plugin
  gets the new values as soon as you save or reset them, and the values of whoever signs in
  next. It receives a secret setting's value too, in plain form, as it needs it to use the
  token; other plugins never do. A plugin's panel can open this form, for example from a
  "Configure" button, but never sees the values.
- **Turning it on.** The switch on the plugin's row in Settings → Plugins starts it, and the row
  shows Running, Stopped, Crashed or Timed out. On the desktop a plugin left on starts again
  with the app. On the web, plugins are turned on per account in that browser: signing out
  stops them and signing in starts those the account turned on.
- **Panels.** The side rail's **Plugins** entry opens a menu with one row per panel of every
  running plugin, showing the plugin's name and the panel's title. Choosing a row opens the
  panel; with no running plugin that has a panel, the menu offers **Manage plugins**. The entry
  stays marked while a plugin panel is open. A panel opens next to the tool panel or, like the
  Pods panel, in place of the conversation. Its header shows the panel's title, the plugin's
  name, its kind and where it came from, and a close button. [UI shell](ui-shell.md) describes
  the menu's keys.
- **"Open \<panel\>" commands.** Each panel of a running plugin also has an "Open \<panel\>"
  command in the palette, such as "Open Pull requests", which a keybind can run too.
- **Commands.** The palette lists a plugin's commands under the plugin's name. A command that
  needs arguments is not listed; its plugin's panel runs it. A dangerous command opens
  **\<command\>?**, which says "\<plugin\> marks this command as dangerous. It runs only if you
  confirm.", shows the arguments, and offers **Run it** or **Cancel**.
- **Context actions.** A plugin's context actions appear at the end of a message's context menu.
  None of the official plugins declares one.
- **Keybinds.** On the desktop, Settings → Keybinds lists the suggestions of turned-on plugins
  that are not bound yet under **Plugin Suggestions**; **Assign** binds one. A plugin command
  marked keybind-capable can also be bound like any other command. Bindings to plugin commands
  stay on this device, marked **This device**; [Keyboard](keyboard.md) explains the layers.
- **The AI agent.** On the desktop, Settings → Plugin AI lists the plugins with commands the
  agent can call. The first approval for a plugin, of one command or with **Approve all**,
  asks in **Grant AI Access?**; the agent then calls an approved command without asking each
  time. **Revoke all** on a plugin and **Revoke all grants** for every plugin take the approvals
  back.

## Trust and permissions

The **Plugin Permissions** dialog opens after every install and from **Permissions** in a
plugin's **⋯** menu. It shows the plugin's name, version and author; its description under "From the
plugin author:", which is the author's claim, not the app's; and what the kind of plugin means:

- Sandboxed: "Runs sandboxed in this app. It cannot read your files, run programs, or use your
  RIM session. It reaches RIM only through the permissions below."
- Runs on this computer: "Runs as a program on this computer with your account's access. It is
  not sandboxed: it can read your files and use the network whatever you approve below. Install
  it only if you trust its author."

Each permission has a checkbox, checked at first. Unchecking one denies it, and **Approve**
grants the rest; right after an install the button is **Approve and turn on**, which also starts
the plugin. The prompt names them like this:

| Capability | What the prompt says |
|---|---|
| `ui.panel` | Render UI Panels |
| `ui.notify` | Show Notifications |
| `network.fetch` | Connect to listed sites: send and receive data from the sites the plugin lists, named one by one. Anything you show this plugin can be sent to these sites. |
| `chat.read` | Read your conversations, except those of encrypted DMs and groups |
| `chat.write` | Post as you, except in encrypted DMs and groups |
| `chat.read.encrypted` | Read your encrypted DMs and groups: their decrypted text, which the plugin can send anywhere its other permissions allow |
| `chat.write.encrypted` | Post as you in your encrypted DMs and groups |

An encrypted chat permission needs its plain one: checking it checks the plain one, and
unchecking the plain one unchecks it.

**Activity** in a plugin's **⋯** menu shows what it holds and did:

- **Approved permissions**, each with **Revoke**. Revoking a permission stops the plugin, and
  revoking a plain chat permission takes its encrypted one with it.
- **Encrypted messages read**, a count per day for the last 14 days.
- **Permission history**, the latest 20 grants and revocations with their times.

**A changed bundle** (desktop). The app records a fingerprint of a plugin's folder when it
installs it. When the files change afterwards, the row shows "Plugin bundle has changed", the
switch can turn the plugin off but not on, and the app does not start it at launch. **Trust new
version** accepts the new files and keeps the approvals, and starts the plugin if it is on.
**Dismiss** turns the plugin off and hides the warning on this device until the files change
again; the **Bundle changed** badge beside the name stays, and clicking it brings the warning
back. The web app hashes a plugin's bundle again at every start instead, and fetches it again
from its link when it is missing or damaged.

**Signed and unsigned.** The row's chips and the panel header say where a plugin came from:

- `Unsigned · installed from a link (<host>)`
- `Unsigned · installed from git (<host>)`
- `Unsigned · installed from a folder`
- `From the workspace registry`

The app does not use the word "sideloaded", but that is what the first three are: installed by
hand, with no publisher's signature, and trusted only as far as their source. The link field
says so: "Plugins from links are not signed: install one only if you trust where the link came
from." A registry plugin carries its publisher's signature, which every device verifies. Its
badge reads `Signed by Ada · rimp1_txDLbnip` when a member of the workspace has the publisher's
principal id; otherwise it quotes the name the publisher chose and adds "(not a member of this
workspace)", since that name proves nothing. Hovering shows the whole id, and a button copies
it. If the publisher later recovers their key, the installed copy keeps running, Settings says
"The publisher recovered their key: ask for a re-signed version", and nothing new installs from
that statement.

**Signing and publishing.** On a desktop that holds the account's identity key (Settings →
Security shows it), each row's **⋯** menu has **Sign and publish…**. It signs the plugin as installed. An
Owner or Moderator of the open workspace then picks Recommended or Required and chooses
**Publish**; anyone can **Export…** a `.rimsig.json` to send to one of them, who adds it in
Workspace settings → Plugins with "Add from files".

## Managing and removing

- **Turn it off** with the switch. The plugin stops and its commands and panels leave the app;
  its permissions and data stay.
- **A plugin that did not start.** A sandboxed plugin whose start was cut short, because the app
  closed while starting it, is not started again, and Settings says so. Turning it off and on
  retries.
- **Uninstall…** in the row's **⋯** menu, then **Uninstall** in **Uninstall \<name\>?**. On
  the desktop the plugin is removed from this device with the permissions granted to it, the
  data it stored and its settings for every account, secret ones included, and its folder
  leaves the plugins folder and is deleted. A folder the app did not install itself stays where
  it is. In the web app the plugin is removed from that browser for your account, with its
  permissions, data, settings and files. To use it again, install it again.

Where plugins live:

| What | Desktop | Web |
|---|---|---|
| The plugin's files, both kinds | `~/.rim/plugins/<plugin_id>/`, or `%USERPROFILE%\.rim\plugins\<plugin_id>\` on Windows | The browser's IndexedDB database `rim-plugins` |
| Install records, approvals and activity | `plugin_state.json` in the app data folder | The same database |
| Data a plugin stores | `plugin_storage/<plugin_id>/` in the app data folder | The same database |
| Settings | `plugin_settings/<plugin_id>/` in the app data folder; secret ones in the [secret vault](secret-vault.md) | The same database; no secret settings |

[Install](install.md) lists the app data folder of each operating system.
