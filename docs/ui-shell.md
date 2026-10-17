# RIM Desktop UI Shell

This document defines the intended desktop shell for the RIM UI client.

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
