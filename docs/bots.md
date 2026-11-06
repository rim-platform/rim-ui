# Bots in the client

A bot is an account of a workspace that software runs instead of a person. What it is, what it can
reach and what RIM enforces is in `rim-server`'s `docs/bots.md` and `docs/specs/bots-v1.md`. This
page says what the client shows.

## How a bot is marked

- A **Bot** badge, with a bot icon and the title "A bot, not a person", stands next to the name of
  a bot in a message (every display density; in the ultra-compact layout it sits before the colon),
  in a thread, in the workspace member directory, in a conversation's members panel, in the
  mention list and in the picker that adds members to a channel. A bot is always a Guest, so the
  badge replaces the role badge, which would say nothing useful.
- The badge comes from the workspace's member list. A message from a bot that has since been
  deactivated, and so left the member list, carries the same data on its author.

## What the person who added it says

The profile card of a bot (hover over its name or avatar, or open its menu with the ContextMenu key
or Shift+F10 and choose **View profile**) shows three statements and a note:

- **Who runs it**
- **Where what it reads goes**
- **Added by**, or "someone no longer here" when that person has left
- "This is what the person who added it says. RIM can't check it."

The statements are plain text, whatever they contain. The card offers a bot no direct message,
copy-handle, block action, presence or status line.

## Menus

A bot's person menu has no **Send message**, contact, **Copy @username**, **Block…** or **Change
role**. **View profile**, **Time out**, **Delete messages…**, **Kick…**, **Ban…** and, from a
members panel, **Remove from** the channel stay for an Owner or Moderator.

## Mentions and members

A bot is offered by `@` only in a channel it was added to. The picker that adds members to a
channel lists bots to Owners and Moderators only, and never in the pickers for a direct message or
a new channel.

## Older servers

The fields `isBot` and `bot` exist only on a server that lists `bot_disclosure` in
`serverInfo.capabilities`. Every read that asks for them (the member list, a conversation's
messages, a thread, pinned messages, a lens) keeps a second document with them and uses it only
there; see `version-skew.md`.
