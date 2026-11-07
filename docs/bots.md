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

## Bots in a workspace

Every member sees the workspace's bots, read from the member list every member already has: a
bot that was deactivated has left it.

- **The conversation list** has a **Bots** section under the channels, with each active bot by name
  and its Bot badge. Choosing one opens its profile card, the one above, as a dialog: Tab and Enter
  reach it, and Escape closes it and gives focus back. The section is not shown while the workspace
  has no active bot, in the direct space, or on a host that does not list `bot_disclosure`.
- **A channel's header** says "\<n\> bots" after the topic, counting the active bots that are
  members of the channel. It opens **Bots in this channel** where the pinned messages open, beside
  the conversation or over it in a smaller window (Escape closes it there); opening one closes the
  other. Each bot shows its name, the Bot badge, **Who runs it**, **Where what it reads goes**,
  **Added by** and "This is what the person who added it says. RIM can't check it." An Owner or
  Moderator also gets **Manage bots in Settings > Bots**. `workspace.toggle_channel_bots` opens and
  closes it from the palette or a keybind. An encrypted channel has no bots, so it has no count.
- **Your agents.** When a program connected on this device (Settings > Agents) has a read grant that
  covers the channel, the header also says "your agent can read this", and the panel's **Your
  agents** part names each one: "You let it read this channel.", or "You let it read every channel
  of this workspace, this one included.", with **Change this in Settings > Agents**. This comes
  from the grants kept on this device; nothing is asked of the server.

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
there; see `version-skew.md`. `Bot.seesMemberJoins` goes by `bot_events` and a pipeline action's
`postAsBot` by `pipeline_post_as_bot`, each on the workspace's own host, and on an older host neither
the switch nor the action is offered.

## Managing bots

Settings > Bots is for Owners and Moderators. It is listed under Workspace when the server lists the
`bots` feature as enabled, and not in the direct space. "Open Bots" in the command palette opens it
for the same people.

- **New bot** asks for a name, **Who runs it** and **Where what it reads goes**, each statement 1 to
  200 characters and required. Everyone in the workspace sees both as what the person who added the
  bot says. The first token is shown in a dialog that holds it only while it is open.
- **Can see when people join**, on the form on a server that lists `bot_events`, lets the bot's program
  get each new member's name and when they joined from `/api/bot/v1/events`. It is off unless turned on,
  it shows on the bot's row while on, and only from then on does the program hear of anyone joining.
- A pipeline can post as a bot when someone joins: `commands-and-automation.md`, "Post as bot".
- **Edit** changes the name and the statements. **Deactivate** is final: its tokens and webhooks stop
  working, it leaves the workspace, and its messages stay. A workspace holds at most 25 active bots.
- **Tokens** lists each token's label, when it was made and last used ("Never" when unused), and
  revokes one after a confirmation. A bot has at most 5 tokens that are not revoked. A new token is
  shown once.
- **Channels** ticks the channels the bot is in and adds or removes it on Save, which sits above the
  list so Tab reaches it first. Encrypted channels are not listed. A private channel you aren't in
  doesn't appear here. Adding a bot to a private channel lets it read that channel. The list loads up
  to 1,000 channels and says when it was cut; the New webhook channel picker does the same.
- **Incoming webhooks** is listed on a server that lists `incoming_webhooks`. **New webhook** takes a
  channel without an active webhook, an active bot and a preset (Plain or GitHub), and shows the
  URL once. It is built from the address of the server the app is signed in to, never the page's
  own address. For the GitHub preset the dialog says to paste it as the Payload URL under the
  repository's Settings > Webhooks, choose application/json and leave Secret empty.
- **Formats**, on a host that lists `webhook_formats` (the contract is rim-server's
  `docs/specs/bots-v1.md`, "Webhook formats"). New webhook's **Format** offers Plain, GitHub, each of
  the host's other ready-made formats, such as Grafana, and Custom. GitHub is sent as the GitHub
  preset, as before. Another ready-made format is sent as a copy, and its setup note comes from the
  host. Custom opens the format editor, and the webhook is made when that is saved. Each row shows
  GitHub, Plain or Custom, and **Edit format** opens the editor on that webhook, whose URL stays the
  same. Editing an unedited GitHub webhook makes it a copy, which then stops getting RIM's updates
  to that format, and the editor says so. On an older host, Preset stays Plain or GitHub.
- **The format editor** works at 360 px and from the keyboard alone, with native controls. **Start
  from** copies a ready-made format and its sample. Each rule is a card: conditions as rows (Header
  or Field, a name and what it equals), the text it posts, an optional link, and Move up, Move down
  and Remove. **Insert a field** offers the field names of the sample, at most 500, read in the app
  only to offer them. **Try it** takes headers as `Name: value` lines and a body, and says which
  rule matches and what it would post, drawn as a message is, or why nothing would. **Copy as JSON**
  and **Paste JSON** share a format. A refusal from the server is shown beside the rule it names.
- **What arrives**, on a host that also lists `webhook_test_sessions`, shows what a service really
  sends. For a new webhook, **Start test URL** gives a URL that posts nothing; saving keeps it, so
  nothing changes in the service, and the URL dialog says so. For an existing webhook, **Listen**
  copies what reaches it while it keeps posting. What arrives is held on the server in memory for up
  to an hour, and only the person who started it can see it. Each delivery is a row, newest first,
  with its time, the event a header names and its outcome under the format on screen, worked out
  again when the format changes. Opening a row shows its `Content-Type`, its headers and its body as
  plain text with invisible characters named, and **Use as sample** fills Try it. A form-encoded
  body says to choose `application/json`. Closing the editor ends the session. With only
  `webhook_formats`, the log isn't shown and Try it still works.
- **Build with AI**, in the editor, asks the person's own model, with their own key: RIM runs none.
  It takes what the post should say and Try it's sample. On the desktop app with a key set, it says
  "This sends what you wrote and the sample to" the provider before anything is sent, and asks the
  model with no tools, so it can only answer with text. The answer is only a draft: it is checked
  with a preview of the sample, sent back to the model once with the reason when it is refused, and
  put in the editor, after asking when rules are already written. Nothing is saved until the
  person presses Save, and the server checks it again. On the web, or with no key, **Copy prompt**
  puts the same prompt, sample included, on the clipboard for any AI, and Paste JSON brings the
  answer back.
- **New webhook…** in a channel's menu (the Moderation section, from the sidebar row, the right
  click or the conversation header's "…" button) makes the same webhook for that channel, with the
  channel fixed. It is offered to Owners and Moderators for a channel that is not encrypted or
  archived, on a server that lists `bots` and `incoming_webhooks`, and not in the direct space. A
  channel with an active webhook, or a workspace with no active bot, gets a message and an Open
  Bots button instead of the form; a bot is never made from there. The URL is shown once, as in
  Settings.

The token or URL is never kept in the query cache or logged. The dialog that shows it replaces
the dialog it came from, has no close icon, and closes only through its Done button; the Tokens
dialog comes back after it.

