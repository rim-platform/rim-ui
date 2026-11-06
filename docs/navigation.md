# Navigation and window width

Every place in the app can be reached from a visible control or a command, at every window
width. Commands run from the palette, from a keybind, from a macro and from the AI agent.

## Window widths

The shell measures its own width and sorts it into one of three classes. The person's saved
choices, such as the collapsed sidebar and zen mode, are never changed by the class.

| Class | Width | What changes |
|---|---|---|
| wide | 1100 px and up | Nothing: the workspace rail, side rail and tool panel sit beside the conversation, and a thread, the pinned messages and a plugin panel take their own columns. |
| medium | 760 to 1099 px | The side panel stays. A thread, the pinned messages and a plugin panel in the tool panel slot open over the right of the main area, up to 420 px wide, full height. Escape closes the one in front, and focus returns to where it was. |
| narrow | under 760 px | The workspace rail, side rail and tool panel are hidden. A menu button in each page's header opens them as a drawer over the main area. A press outside the drawer, Escape, or choosing a conversation, a page or a plugin panel closes it. A thread, the pinned messages and a plugin panel fill the main area. Settings lists its sections in one menu above the content. |

The drawer holds the same workspace rail, side rail (inbox, plugins, notifications, search,
audit log, settings, account menu) and conversation list as the wide layout. When the notification
inbox, a member list or a new-message or new-channel dialog is asked for in a narrow window, the
drawer opens to show it.

These are narrow desktop and browser windows. The web app has no phone layout: there are no
gestures and no bottom bar.

## Ways in

| Place | Control | Command |
|---|---|---|
| A conversation | Conversation list; Inbox on the side rail | `workspace.navigate_to_channel`, `workspace.next_channel`, `workspace.previous_channel`, `workspace.next_unread_channel`, `workspace.previous_unread_channel` |
| Settings and its tabs | Settings on the side rail; the account menu; in a narrow window the sections menu | `workspace.open_settings` |
| Plugin panels | Plugins on the side rail | `workspace.open_plugin_panel.<plugin>/<panel>` for each panel |
| Marketplace | none yet | `workspace.open_marketplace` |
| Audit log | Audit log on the side rail | `workspace.open_audit_log` |
| Message requests | Requests row in the conversation list | `workspace.open_message_requests` |
| Search | Search on the side rail; the search button in a conversation header | `workspace.open_search`, `workspace.search_in_channel` |
| A thread | Reply in thread on a message | `workspace.reopen_last_thread` |
| Pinned messages | Pin button in a channel header | `workspace.toggle_pinned_messages` |
| Notifications | Bell on the side rail | `workspace.toggle_notifications` |
| A conversation's members | Member count in a channel header | `workspace.toggle_conversation_members` |
| The workspace's members | Members button above the conversation list | `workspace.toggle_member_directory` |
| Command palette | none | `workspace.open_command_palette` |
| Agents | Settings > Agents | `workspace.open_agents` |
| Bots and webhooks | Settings > Bots | `workspace.open_bots` |
| The sidebar, or the drawer in a narrow window | Menu button in a narrow window | `workspace.toggle_sidebar` |

Settings tabs: Profile, Account, Security, Desktop, Contacts, Messages, Direct messages,
Notifications, History, Keybinds, Keyboard, Commands, Macros, Pipelines, Plugins, Plugin AI,
State, Emoji, Agents, AI Agent, Workspace, Moderation, Bots, Instance moderation, About. Some are
shown only to a role, a server feature or the desktop app, as the Settings page decides;
`src/shell/reachable.test.tsx` checks that every tab is listed for someone who may see it.
