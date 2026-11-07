# Home

Home is made of boxes, each half or full width, in an order you choose. Your layout is saved to
your account on your own server, so every device shows the same Home. The rules the server
follows are in rim-server's `docs/home-layout.md`; this page is how the app uses them.

## The boxes

| Box | Shows | Runs |
|---|---|---|
| Waiting for you | Message requests and join requests to decide on | everywhere |
| Mentions and replies | Unread mentions and replies across your workspaces | everywhere |
| Unread | Unread messages per workspace, and See all unread | everywhere |
| Your agents' runs | The newest runs of the agents connected on this device | the desktop app |
| Direct messages | Your latest direct messages and groups, 3, 5 or 10, with their unread counts | everywhere |
| Channel | The latest 3, 5 or 10 messages of one channel you pick | everywhere |
| Quick actions | 1 to 6 buttons, each running a command you chose | where the command runs |

Channel and Quick actions can be on Home more than once, each with its own settings; the other
boxes once.

### Channel

A channel box is named after its channel and workspace, such as "#deploys in Platform". It reads
the channel through the same query and cache as the channel's timeline and shows its messages the
way the timeline does, condensed: a flagged message stays covered, and an encrypted message shows
where the timeline would show it. Where this browser holds no text of encrypted messages, the box
says how to link it, as the timeline does. Its messages arrive as they are sent while the
channel's workspace is the open one, and are read again every minute for any other workspace. A
workspace on another server is read from that server, as everywhere else in the app.

Showing a channel box marks nothing read. A click on a message opens it in its channel.

A channel you can no longer see, or one deleted or archived, says so in its box, with Remove,
which takes the box off Home on every device.

### Direct messages

The latest conversations of the direct messages list, from what that list already loads, each
with its unread count. A row opens its conversation; nothing is marked read.

### Quick actions

Each button runs its command as a click in the command palette does: a command that asks for
confirmation still asks, and its outcome shows as it would from the palette. The commands offered
are those a key can be bound to, with optional arguments as a JSON object of at most 4096 bytes,
as for a personal keybind. Edit Home is never one of them. A command not offered on this device,
such as one of a plugin that isn't installed here or one that needs the desktop app, is a
disabled button with the reason beneath it.

Until you change it, Home shows today's default: Waiting for you, Mentions and replies, Unread,
and Your agents' runs where agents are connected. The default comes from the app and is not
saved: opening Home saves nothing, and your first Done is what saves a layout to your account.

The workspace filter above the boxes still limits every box to one workspace while Home is open.

## Editing Home

Edit Home, on Home or in the command palette, turns each box into one you can change:

- **Move up** and **Move down** reorder it. Focus stays on the button you pressed, and the new
  place is announced, such as "Moved Mentions and replies to position 1 of 3".
- **Half** and **Full** set its width.
- **Settings**, on a box that has them, opens them in a dialog: Save keeps them, Cancel or
  Escape leaves them. The number of messages or conversations is 3, 5 or 10.
- **Remove** takes it off Home. A box this device can't run asks first, since it is removed from
  every device.
- **Add a box** lists the boxes that can be added: a panel beside the boxes, or a sheet in a
  narrow window. Adding a Channel or Quick actions box opens its settings first, and Cancel
  there adds nothing.
- **Done** saves, **Cancel** drops the changes, and **Escape** is Cancel, asking first when
  something changed. **Reset to default** asks first, then deletes your saved layout, so every
  device goes back to the default.

Edit Home is a command of this app only. It is not offered to keybinds, and nothing that runs
commands, such as a macro, a pipeline or an agent, can change your Home.

Under 760 pixels of room the boxes stand in one column; from there in two, with a full box across
both. Dragging is not built: Move up and Move down are the way to reorder.

## What each device keeps

Each device keeps, for each account, sealed with the account's other values:

- a copy of the layout the server last answered;
- an edit not sent yet, with the time you pressed Done;
- the boxes you chose not to show on that device.

Nothing a box shows is kept: what Home last loaded stays in memory as before, and the web app
gets no offline mode from Home. A browser whose storage was cleared shows the default layout
until the server answers.

## Two devices

The edit made last wins. Each save carries the time you pressed Done, and the server keeps the
later one. When your save loses, or Home fetches a layout newer than this device's copy, Home
shows that layout with "Your layout changed on another device, so Home now shows that one." until
you press OK.

An edit made while your server can't be reached waits on the device and is sent when the server
answers again. An edit the server refuses is dropped, and the app says it wasn't saved.

## When something can't run here

- **A box this device can't run**, today only Your agents' runs in the web app, is one line in
  its place saying why. "Don't show on this device" hides it here alone; it stays in your layout
  for every other device. Edit Home lists the boxes hidden here under "Not shown on this device",
  with Show here.
- **Settings this app can't read**, such as a count of 7, make the box one line, "This box's
  settings need fixing", with Fix settings, which opens them.
- **A box from a newer version of RIM** is one line in its place, "This box needs a newer version
  of RIM", and is saved back unchanged, its settings included.
- **Your server can't be reached:** Home shows this device's copy of the layout and what it last
  loaded, says so above the boxes, and marks the boxes whose content comes from the servers "not
  up to date". This follows the app's own connection state; Home checks nothing of its own.
- **A server without Home layouts** (one that does not list `home_layout` in its capabilities):
  Home shows the default layout, asks nothing about layouts, and offers no Edit Home.

## Encrypted conversations and other servers

The layout holds box kinds, ids and settings: a channel box's workspace and channel ids and a
quick action's command and arguments, never messages. A workspace on another server keeps updating
its boxes while your own server is away, since its content comes from its own host; the layout
itself lives on your own server only.
