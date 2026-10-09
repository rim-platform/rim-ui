# GitHub Pull Requests

Lists the open pull requests of up to 10 public GitHub repositories in a RIM panel:
title, author, age and whether it is a draft. A `WebSandboxed` plugin built on the
[TypeScript SDK](../../sdk/plugin-sdk/README.md): it runs in a sandboxed frame of the app,
on the web and on the desktop alike.

## What it can reach

The plugin asks for two permissions:

- **Render UI Panels** (`ui.panel`), to show the list.
- **Connect to listed sites** (`network.fetch`), for `api.github.com` (the pull requests)
  and `avatars.githubusercontent.com` (the authors' pictures). The frame's content
  security policy blocks every other site.

It uses no token, so it sees public repositories only. GitHub allows 60 requests an hour
per IP address without one, so the plugin refreshes on its own every 5 minutes, at most
every 2 minutes when you ask, and stops asking and says so when GitHub refuses. The list
of repositories is kept in the host's plugin store for your account on this device.

## What it does

| Command                                              | What it does                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| **Pull requests: Refresh** (`refresh`)               | Fetches the open pull requests again. Keybind capable.                      |
| **Pull requests: Add repository** (`add_repo`)       | Adds `owner/name` (or a `https://github.com/owner/name` link), at most 10. |
| **Pull requests: Remove repository** (`remove_repo`) | Removes a repository.                                                       |

The **Pull requests** panel opens next to the tool panel. Add a repository at the top,
remove one with **×**; <kbd>r</kbd> refreshes and <kbd>/</kbd> jumps to the field. The
panel has no links: following one would navigate the panel's frame, which closes it.

## Build and install

1. `npm run plugin:bundle -- plugins/github-prs` writes `plugins/github-prs/dist/chat.rim.github-prs/`
   and `plugins/github-prs/dist/chat.rim.github-prs-0.1.0.rimbundle`, and prints the
   bundle's `sha256` and size.
2. On the desktop: **Settings → Plugins → Install from local folder** and pick the folder.
3. On the web or the desktop: serve the `.rimbundle` over https with
   `Access-Control-Allow-Origin: *`, then **Settings → Plugins → Install from link** with
   `https://<host>/chat.rim.github-prs-0.1.0.rimbundle#sha256=<the printed hash>`.
4. Approve the permissions, enable the plugin, and open **Pull requests** from the side rail.

## Tests

`npm test` runs `plugin.test.ts` (the plugin over a `MessageChannel` with a pretend
GitHub and store) and `panel.test.ts` (the panel page in jsdom).
