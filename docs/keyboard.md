# Keyboard

Everything in the shell is reachable without a mouse. This page describes how keys are
resolved, the keybind profile file, and the opt-in Vim layer.

## Where a key goes

A key pressed in a keystroke recorder (Settings → Keybinds) goes to the recorder only. Any
other keydown passes through, in order:

1. **The Vim layer** (only while Vim mode is on). It takes unmodified keys outside text fields
   and `Ctrl+[`. Keys in a text field, a select or a plugin frame pass through untouched.
2. **The keybinds** (`KeybindProvider`). One binding per keystroke and context, highest layer
   first:
   - bindings kept on this device: plugin commands, the commands that open a plugin's panel
     and the app's own commands, which the server does not know;
   - the user's and the workspace's bindings from the server;
   - the active keybind profile;
   - the server's default bindings.

   A keystroke a higher layer holds, even turned off, is gone from the layers below. Inside a
   text field, keys that type a character and the editing chords (word jumps, select all,
   clipboard, undo, redo) stay with the field.
3. **The focused surface**: lists answer arrow keys, Home and End; dialogs close on Escape;
   menus move with the arrows, Home and End, open a submenu with ArrowRight or Enter and close
   it with ArrowLeft or Escape. The ContextMenu key or Shift+F10 opens the context menu of the
   focused item, as a right click does (`ui-shell.md`, Context Menus).

The keyboard shortcuts panel (`?` or `Ctrl+/`, or Settings, Keyboard) lists the bindings this
resolution produces, so it always matches what the keys do.

## Keybind profiles

A profile is the default binding set of a device plus the Vim switch. Three are built in:

| Profile        | Vim mode | Bindings                                                                                                                         |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Minimal        | off      | The plain default set. A new device starts here.                                                                                 |
| Vim            | on       | The plain default set.                                                                                                           |
| Mouse-friendly | off      | The default set without `Ctrl+R`, `Ctrl+B`, `Ctrl+E`, `Ctrl+D`, `Ctrl+L`, `Ctrl+Shift+Z`, `Ctrl+ArrowLeft` and `Ctrl+ArrowRight` |

Mouse-friendly leaves those keys to the browser and the text field: reload, bold, the search bar,
bookmark, the address bar, redo and word jumps.

Settings, Keyboard exports the active profile and imports one. The file:

```json
{
  "format": "rim.keybind-profile",
  "version": 1,
  "name": "Team keys",
  "description": "Optional text",
  "vimMode": false,
  "bindings": [
    { "keystroke": "Ctrl+K", "commandId": "workspace.open_command_palette" },
    { "keystroke": "Ctrl+J", "commandId": "workspace.open_search", "context": "GLOBAL" },
    { "keystroke": "Ctrl+R", "commandId": null }
  ]
}
```

- `keystroke`: modifiers `Ctrl`, `Shift`, `Alt` (or `Meta` or `Cmd`, read as `Ctrl`), in any
  case, joined by `+`, then a key name as the browser reports it (`K`, `ArrowDown`, `Escape`,
  `?`). Import puts it in canonical form.
- `commandId`: any command id, or `null` to free the keystroke so no lower layer binds it.
- `context`: `GLOBAL` (the default), `COMPOSER`, `MESSAGE_LIST`, `THREAD_VIEW`,
  `CONVERSATION_VIEW`, `PANEL` or `COMMAND_PALETTE`.

Import checks every field and lists every problem with its position. A profile of a newer
version is refused with a message saying so.

## Timeline navigation

Escape in the composer, or focusing the message list, enters NAVIGATE: the status bar shows
NAVIGATE and a bar over the bottom of the timeline lists the keys for the selected message; the
timeline leaves room for the bar under the newest message. Entering it with the keyboard selects
the newest message; clicking into the list selects the message clicked, without scrolling.
Focusing the composer or a thread's reply box shows COMPOSE.

## Vim mode

Off by default. Normal mode is any focus outside a text field; insert mode is a focused text
field or plugin frame. The status bar shows the mode.

| Keys          | Normal mode                                                    |
| ------------- | -------------------------------------------------------------- |
| `h` `l`       | Focus the pane to the left or right                            |
| `j` `k`       | Next or previous item of the focused list, else of the pane    |
| `gg` `G`      | First or last item                                             |
| `n` `p`       | Next or previous unread conversation (not in the timeline)     |
| `/`           | Search this conversation                                       |
| `:`           | Open the command palette                                       |
| `i`, `Enter`  | Focus the composer (Enter only when no button is focused)      |
| `3j`          | A count repeats a motion                                       |
| `Esc`, `Ctrl+[` | Leave the text field for its pane                            |

The timeline keeps its own message keys (`r`, `e`, `p` to pin, `d`, `c`, `f`) in both modes.
