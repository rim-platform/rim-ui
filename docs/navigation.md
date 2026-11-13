# Navigation and window width

Every place in the app can be reached from a visible control or a command, at every window
width. Commands run from the palette and from a keybind. The commands this app adds itself, such as the
ones for the audit log and the panels, are not on the server's list, so macros and the assistant do
not get them.

## Window widths

The shell measures its own width and sorts it into one of three classes. The person's saved
choices, such as the hidden conversation list and zen mode, are never changed by the class.

| Class | Width | What changes |
|---|---|---|
| wide | 1100 px and up | Nothing: the workspace rail and the tool panel sit beside the conversation, under the top bar, and a thread, the pinned messages and a plugin panel take their own columns. |
| medium | 760 to 1099 px | The side panel stays. A thread, the pinned messages and a plugin panel in the tool panel slot open over the right of the main area, up to 420 px wide, full height. Escape closes the one in front, and focus returns to where it was. |
| narrow | under 760 px | The workspace rail and tool panel are hidden. The top bar stays, 48 px high: the menu button at its left opens them as a drawer over the main area, then the search field, Plugins and Notifications. Below 400 px the search field says only "Search" and its accessible name stays "Search or run a command". Back and Forward are hidden. A press outside the drawer, Escape, or choosing a conversation, a page or a plugin panel closes it. A thread, the pinned messages and a plugin panel fill the main area. Settings lists its sections in one menu above the content. |

The drawer holds the same workspace rail (Home, direct messages, the workspaces, audit log,
settings, account menu) and conversation list as the wide layout. When a member list or a
new-message or new-channel dialog is asked for in a narrow window, the drawer opens to show it.
The notification inbox opens under the top bar at every width.

## The top bar

The top bar sits above the conversation list and the main area on every page, and zen mode hides
it with the rails. It is a landmark named "Top bar"; Tab reaches it, and so does moving between
panes (`workspace.navigate_panel_left` and `workspace.navigate_panel_right`), between the
workspace rail and the conversation list. On the left are **Back** and **Forward**. In the middle
is a button that looks like a search field and runs `workspace.open_search`, which opens the
search box under it ([Search UI](search-ui.md#the-search-box)). It names what it searches: the
open workspace, the direct messages in the direct space, or everything on Home and Unreads, and it
shows the keystroke bound to `workspace.open_search`. On the right, **Plugins** opens the menu of plugin panels under it
and shows only while a running plugin has a panel, and **Notifications** opens the notification
inbox under it. Escape closes either one and gives focus back to its button.

**Back** and **Forward** (`workspace.go_back`, `workspace.go_forward`) move through the places
opened in this window: a workspace, a page, and the conversation open on it. The history keeps the
newest 50, and opening a new place after Back drops the ones that were forward. It is the app's
own: the browser's history is never changed, so the web app's own back button still leaves the
page as before. Neither command has a default keystroke, since <kbd>Alt+ArrowLeft</kbd> is Back
to Workspace; bind them in Settings > Keybinds. The mouse's back and forward buttons are not
used.

In the desktop app, which draws its own window frame, the top bar is the title bar: its empty
areas drag the window, and the window controls sit at its far right outside macOS. Zen mode, the
sign-in screens and the workspace picker keep the plain title bar.

These are narrow windows. The web app has no phone layout: there are no
gestures and no bottom bar.

## Ways in

| Place | Control | Command |
|---|---|---|
| A conversation | Conversation list | `workspace.navigate_to_channel`, `workspace.next_channel`, `workspace.previous_channel`, `workspace.next_unread_channel`, `workspace.previous_unread_channel` |
| Settings and its tabs | Settings at the foot of the workspace rail; the account menu; in a narrow window the sections menu | `workspace.open_settings`; Browse Plugins opens Settings > Plugins: `workspace.open_marketplace` |
| Plugin panels | Plugins in the top bar | `workspace.open_plugin_panel.<plugin>/<panel>` for each panel |
| Home | Home at the top of the workspace rail | `workspace.open_home` |
| Editing Home | Edit Home on Home, where the server keeps Home layouts | `workspace.edit_home`, from the command palette only |
| Unreads | See all unread on Home; Unreads above the channels in the conversation list, while something is unread | `workspace.open_unreads` |
| Audit log | Audit log at the foot of the workspace rail, while a workspace other than the direct space is open | `workspace.open_audit_log` |
| Message requests | Requests row in the conversation list | `workspace.open_message_requests` |
| Search | The search field in the top bar; Search all messages in the search box; the search button in a conversation header | `workspace.open_search`, `workspace.search_in_channel` |
| A thread | Reply in thread on a message | `workspace.reopen_last_thread` |
| Pinned messages | Pin button in a channel header | `workspace.toggle_pinned_messages` |
| Bots in this channel | "\<n\> bots" after a channel's topic | `workspace.toggle_channel_bots` |
| A bot's card | A bot in the Bots section of the conversation list | none |
| Notifications | Bell in the top bar | `workspace.toggle_notifications` |
| A conversation's members | Member count in a channel header | `workspace.toggle_conversation_members` |
| The workspace's members | Members button above the conversation list | `workspace.toggle_member_directory` |
| Command palette | The search field in the top bar, then <kbd>&gt;</kbd> | `workspace.open_command_palette` |
| The place before or after this one | Back and Forward in the top bar | `workspace.go_back`, `workspace.go_forward` |
| The assistant's plugin commands | Plugin commands it may run, in Settings > Assistant | `settings.open.plugin_ai` |
| Agents | Settings > Agents | `workspace.open_agents` |
| Bots and webhooks | Settings > Bots & webhooks | `workspace.open_bots` |
| A channel's incoming webhook | New webhook… in the channel's menu | none |
| A webhook's format, and what a service sends to it | Edit format on the webhook's row in Settings > Bots & webhooks, or Custom in New webhook | none |
| The conversation list, or the drawer in a narrow window | Menu button in the top bar of a narrow window | `workspace.toggle_sidebar` |

Settings tabs, by group: You (Profile, Account, Security, Desktop, Contacts); Messaging
(Messages, Direct messages, Notifications, History, Emoji); Shortcuts & automation (Keyboard,
Keybinds, Commands, Macros, Pipelines, State); Tools & AI (Plugins, Assistant, Agents);
Workspace (Workspace, Moderation, Bots & webhooks); Instance (Instance moderation); About. Some are
shown only to a role, a server feature or the desktop app, as the Settings page decides;
`src/shell/reachable.test.tsx` checks that every tab is listed for someone who may see it.
