# RIM Desktop UI Shell

This document defines the intended desktop shell for the RIM UI client; the shell as built, which
differs from it in places, is described in [`getting-started.md`](getting-started.md).

It is a design and implementation target for the Tauri app in this repository. It should help keep
layout, interaction, and runtime decisions aligned with the product direction in `../rim-server`.

## Goal

RIM is a desktop-first chat workspace, but the product is not just messaging.

The desktop client should combine:

- communication
- commands
- keybinds
- plugins
- context-aware workflows

The app should feel closer to a focused workspace tool than a generic social or web chat client.

## UX Principles

- Keyboard-first: the command palette, keybinds, and focus movement are core UX, not hidden extras.
- Desktop-first: optimize for larger windows, denser information, and fast navigation.
- Communication-first: chat remains the main surface, even as workflows grow.
- Workflow-native: commands, context actions, and plugin panels should feel built in.
- Trust-visible: built-in, plugin, integration, and user-defined behavior should be distinguishable.
- Low-friction: common actions should require minimal pointer travel and minimal mode switching.
- Performance-aware: long lists and heavy surfaces should be built for virtualization and lazy loading.

## Main Regions

The shell is composed of five primary regions.

1. Side Rail
2. Tool Panel
3. Main Workspace
4. Thread Pane
5. Overlay Surfaces

### Region Responsibilities

- Side Rail: global navigation, workspace switching, built-in destinations, plugin entry points.
- Tool Panel: one active supporting panel at a time, such as inbox, channels, DMs, search, or plugin panels.
- Main Workspace: conversation header, message timeline, composer, and conversation-local actions.
- Thread Pane: threaded discussion tied to a selected root timeline message.
- Overlay Surfaces: command palette, quick switcher, context menus, dialogs, capability prompts.

## Recommended Default Layout

This is the recommended default desktop shell.

```text
+--------------------------------------------------------------------------------------------------+
| Side Rail | Tool Panel                            | Main Workspace                    | Thread     |
|-----------|----------------------------------------|-----------------------------------|------------|
| Workspace | Inbox / Channels / DMs                 | Conversation Header               | Thread     |
| Home      | Search / Filters                       |-----------------------------------| Header     |
| Commands  | Pinned / Recent / Plugin Panel Slot    | Message Timeline                  |------------|
| Plugins   |                                        |                                   | Replies    |
| Activity  |                                        |                                   |            |
| Settings  |                                        |                                   |            |
|-----------|----------------------------------------|-----------------------------------|------------|
| Profile   | Context / status / quick actions       | Composer                          | Reply Box  |
+--------------------------------------------------------------------------------------------------+
```

## Layout Rules

- The side rail is always visible in the standard desktop layout.
- The tool panel shows one active panel at a time.
- The main workspace is always the visual center of the app.
- The thread pane is secondary and can be hidden when not in use.
- Overlays should never permanently replace the app shell; they sit on top of it.

## Side Rail

The side rail is the app's top-level navigation spine.

Expected entries:

- workspace switcher
- home or inbox
- commands or quick actions entry
- a Plugins entry whose menu lists the plugin panels
- activity or notifications
- settings
- current user/profile area

Behavior:

- The side rail should be icon-first and compact.
- It should support unread and activity indicators.
- Plugin panels open from the Plugins entry, not from an icon each, so the rail does not grow
  with every installed plugin. The entry opens a menu beside it with one row per panel of
  every enabled, running plugin: the plugin's name, the panel's title, and a puzzle marker
  that sets the rows apart from built-in destinations. The tool panel stays as it was.
  Choosing a row opens the panel in its slot. The menu works from the keyboard (Enter or Space
  opens it, the arrow keys move, Enter chooses, Escape closes it and returns focus to the entry)
  and closes on a click outside. With no running plugin that has a panel, it links to the plugin
  settings instead.
- The Plugins entry stays marked while a plugin panel is open.
- Each panel of a running plugin also has an "Open <panel>" command, so the palette or a keybind
  opens it without the rail.
- Switching side-rail destinations should update the active tool panel or global workspace mode.

## Tool Panel

The tool panel supports the main workspace instead of replacing it.

Typical uses:

- workspace or conversation browsing
- inbox and recents
- channels and DMs
- search and filters
- pinned items
- plugin panels

Rules:

- Only one tool panel is active at a time in v1.
- The panel should be collapsible.
- The panel may host plugin surfaces, but plugin UI should not own the whole app shell.
- Heavy panel content should be lazy-loaded.

## Main Workspace

The main workspace is where the active conversation lives.

It should contain:

- conversation header
- timeline messages
- message actions
- composer
- local conversation context

The main workspace should prioritize:

- message readability
- fast keyboard interaction
- minimal visual clutter
- clear hierarchy between header, timeline, and composer

## Thread Pane

Threads are a first-class messaging surface.

Rules:

- A thread is anchored to a root timeline message.
- The root message remains in the main timeline.
- Thread replies live in the thread pane, not duplicated into the main timeline.
- The thread pane should open quickly from message actions or keyboard commands.
- The thread pane should preserve orientation: users should easily understand which root message they are reading.

## Overlay Surfaces

The shell should support several overlay surfaces.

Primary overlays:

- command palette
- quick switcher
- message context menus
- confirmation dialogs
- capability prompts
- plugin trust and install dialogs

Guidance:

- Overlays should be visually distinct from docked panels.
- Overlay opening and closing should preserve user context and focus.
- The command palette should feel global and central, not like a secondary utility.

### Context Menus

A context menu holds the actions for the thing under the pointer or the focus, such as a
message. It opens:

- with a right click, at the pointer;
- with the ContextMenu key or Shift+F10 on the focused item, under it;
- with a touch held still for half a second, at the finger. Moving the finger more than a few
  pixels first scrolls instead, and a mouse button held down opens nothing.

The innermost thing wins: a right click or a long press on an author's name or avatar, or on
an @mention, opens that person's menu rather than the message's, and a person has the same menu
in the timeline, in a conversation's members and in the workspace member directory, whose
**⋮** button opens it too.

One context menu is open at a time: opening another closes the first. The arrows move through
the items, skipping section headings; ArrowRight or Enter opens a submenu and ArrowLeft or
Escape closes it again; Escape closes the menu and returns the focus where it was. Choosing an
action closes the whole menu. Items can show a check mark for the current choice of a group and
a muted keybind hint at the right.

The menu belongs to the innermost target: a right click on a link, an image or a file inside a
message opens that link's or attachment's menu, and anywhere else on the message the message's
menu. The surfaces with a menu:

- **A message**, in the timeline and in the thread panel: Add reaction (a submenu of quick
  reactions), Copy selection (while part of the message is selected, since the menu takes the
  place of the system's one there), Copy text, Reply in thread (not in the thread panel),
  Forward…, Pin or Unpin message; Edit message (not in the thread panel) and Delete message… on
  your own message, Report message… on someone else's; a Moderation section with Delete
  message… for an Owner or a Moderator; then the plugins' message actions.
- **A pinned message** in the pinned panel and **a search result**: Jump to message and Copy
  text, and Unpin message in the pinned panel.
- **An attachment**: Open (an image full size, a file in a new window) and Download once it is
  uploaded, Delete attachment when its upload failed. A video offers Download only.
- **A link** in a message or a link preview: Open link and Copy link address. Mentions keep
  their own click.
- **A notification**: Mark as read while unread; Mute conversation (a submenu of durations) or
  Unmute conversation, and Open, while its conversation is readable.
- **A plugin panel's header**: Plugin settings, when the plugin has settings, and Close panel.
- **A conversation** in the sidebar: the same items as the "…" menu in its header (read state,
  notifications with timed mutes, members, invite, topic, a keybind to open it, the Owner and
  Moderator's slow mode and archive, leave), or Accept and Decline for an invitation.
- **A section heading** of the sidebar: Browse channels and Create channel on Channels, Expand
  or Collapse on Archived.
- **A workspace** on the rail: Mark all as read, Pause notifications, Browse channels, Create
  channel, Invite people, a keybind to switch to it and its settings, acting on that workspace
  without switching to it (except for its settings).
- **A message request**: Accept, Read first, Ignore, Report and Block.

Items the viewer cannot use are left out rather than shown disabled.

Where the app has no menu of its own, the desktop app shows no menu at all, except in text
fields, in the composer and over selected text, which keep the system's cut, copy and paste
menu. The web app leaves the browser's menu wherever it opens none of its own. Plugin frames
handle their own right clicks.

## Navigation Model

The app should distinguish between three kinds of navigation.

### Global Navigation

- workspace switching
- top-level destination changes
- plugin panel activation

### Workspace Navigation

- switching conversations
- opening threads
- moving between inbox, channels, and search states

### Ephemeral UI State

- command palette open or closed
- current selection
- focused message
- active composer state
- temporary search input

Guidance:

- Persist shared product state through the backend when appropriate.
- Keep focus, selection, and other runtime-local state in the client.
- Do not over-promote temporary UI state into persisted backend state.

## Command Palette

The command palette is a primary surface, not an optional addon.

It should:

- open from a global shortcut
- search commands quickly
- filter by current typed context
- allow missing-context commands if they can prompt for input
- show command metadata clearly
- show source and trust information

Suggested command metadata in the palette:

- title
- short description
- source kind
- keybind, if any
- context requirements
- dangerous or capability-sensitive status

Trust labels should make clear whether a command is:

- built in
- plugin-provided
- integration-provided
- user-defined

## Context Model In The UI

The UI should treat context as structured runtime state.

Initial core context for the client:

- current workspace
- current conversation
- current thread
- selected text
- selected message
- selected messages
- focused surface
- active panel

Important rule:

- context is not just a loose bag of temporary values
- commands, context actions, and keybinds should consume the same typed context model

## Keybind UX

Keybinds should map to commands, not to one-off handlers.

Initial keybind contexts should include:

- global
- composer
- message list
- thread view
- conversation view
- panel
- command palette

Client/runtime expectations:

- the client owns actual keyboard handling
- the client owns device-local keybinds
- the final precedence should be `device_local > workspace > user > default`
- repeated behavior belongs to the command runtime, not the keybind definition itself

## Plugin Host UX

Plugins should extend shared systems rather than invent parallel UI models.

The desktop client should support:

- plugin panels
- plugin commands
- plugin context actions
- plugin keybind suggestions
- capability prompts
- install/enable/disable flows

Rules:

- plugin-origin UI should remain visible as plugin-origin UI when trust matters
- plugin panels should fit into the same shell structure as built-in panels
- plugin capabilities should be explicit, understandable, and revocable
- dangerous plugin actions should never look identical to harmless built-in actions

## Trust And Capability UX

Trust visibility is part of the product.

The UI should make it clear:

- what action is being run
- where it came from
- whether it is local or remote
- which dangerous capabilities are involved

Capability-sensitive cases include:

- local process execution
- filesystem access
- broad outbound network access
- external state modification

Recommended behavior:

- capability grants are explicit
- dangerous actions default to confirmation
- revoked or missing capabilities fail clearly in the UI

## Messaging Rules For The UI

The messaging views should follow backend contracts.

- Use `workspace` as the product term in the UI.
- Treat channels, DMs, and groups as conversation variants.
- Keep thread semantics aligned with backend rules.
- Preserve attachment, message reference, and permalink expectations.

Pagination implications:

- Use cursor-based pagination for messages, threads, and large conversation lists.
- Do not design around offset/page-number assumptions.
- Order and cursor semantics from the backend should shape infinite scroll behavior.

## Narrow Window Behavior

The app is desktop-first, but it must remain usable in smaller windows.

Recommended behavior:

- side rail stays visible as a compact icon strip
- tool panel may collapse
- thread pane collapses into an overlay or slide-over panel
- command palette remains centered and usable
- composer and message reading remain the top priority

## Visual Direction

Recommended tone:

- serious
- modern
- workspace-oriented
- efficient rather than playful

Recommended density:

- medium-dense
- comfortable for desktop use
- more structured than a social messenger

Visual guidance:

- avoid generic starter-template styling
- use strong visual hierarchy between app regions
- use restrained accent color rather than loud multicolor UI
- motion should support panel transitions, palette opening, and thread reveal without becoming decorative

## Implementation Priorities

Recommended build order:

1. app shell and region layout
2. conversation list and message workspace
3. thread pane behavior
4. command palette and focus model
5. runtime context model in the client
6. keybind runtime behavior
7. plugin panel slots and trust/capability UI

## Open Questions

These should be resolved before deeper UI buildout.

- Should the thread pane be docked by default or hidden until opened?
- Should the tool panel be open by default at all times or collapsible by default?
- Which built-in side-rail destinations ship first?
- What is the initial visual theme: IDE-like, chat-first, or premium minimal?
- Which command palette behaviors are required in the very first usable shell?

## Working Rule

When implementation details are unclear, prefer decisions that make RIM feel like a desktop host for
communication plus workflows, not a dressed-up Tauri starter and not a plain chat clone.
