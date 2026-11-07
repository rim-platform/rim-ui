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

Until you change it, Home shows today's default: Waiting for you, Mentions and replies, Unread,
and Your agents' runs where agents are connected. The default comes from the app and is not
saved: opening Home saves nothing, and your first Done is what saves a layout to your account.

The workspace filter above the boxes still limits every box to one workspace while Home is open.

## Editing Home

Edit Home, on Home or in the command palette, turns each box into one you can change:

- **Move up** and **Move down** reorder it. Focus stays on the button you pressed, and the new
  place is announced, such as "Moved Mentions and replies to position 1 of 3".
- **Half** and **Full** set its width.
- **Remove** takes it off Home. A box this device can't run asks first, since it is removed from
  every device.
- **Add a box** lists the boxes that are not on Home yet: a panel beside the boxes, or a sheet
  in a narrow window.
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
- **A box from a newer version of RIM** is one line in its place, "This box needs a newer version
  of RIM", and is saved back unchanged, its settings included.
- **Your server can't be reached:** Home shows this device's copy of the layout and what it last
  loaded, says so above the boxes, and marks the boxes whose content comes from the servers "not
  up to date". This follows the app's own connection state; Home checks nothing of its own.
- **A server without Home layouts** (one that does not list `home_layout` in its capabilities):
  Home shows the default layout, asks nothing about layouts, and offers no Edit Home.

## Encrypted conversations and other servers

The layout holds box kinds and ids, never messages. A workspace on another server keeps updating
its boxes while your own server is away, since its content comes from its own host; the layout
itself lives on your own server only.
