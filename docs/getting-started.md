# Getting started

This page takes you from a fresh install to your first conversation: creating an account, finding
a workspace, talking, finding your way around the app and keeping the account safe. It is for the
person using the app; [Install](install.md) covers getting the app itself.

## Before you start

You need the RIM desktop app ([Install](install.md)) or a current browser open at a RIM server's
web address, and a server to join. Every release of the desktop app signs in to the public relay
`relay.rim-platform.org`; **Use another server** on the sign-in page moves it to your own or your
team's server ([Use another server](install.md#use-another-server)). The web app always uses the
server that serves it. A server is open to anyone, invite-only, or, like the public relay, takes
new accounts that prove they come from a real device. On an invite-only server you need an invite
from someone there: open its link in a browser, whose page creates your account, or give the link
or its code to **Create account** in the app.

## Create your account

Choose **Create account** on the sign-in page, or open your invite link. A workspace invite says
"You're joining \<workspace\>" and who invited you. On an invite-only server the sign-in page says
that creating an account takes an invite code or link. Where the app can hold keys (the desktop
app, and any browser with WebCrypto Ed25519 and IndexedDB) the form creates an account with a key:
no password and no email. The device keeps a key that signs you in, and a recovery kit gets the
account back if you lose it.

- **Invite code**, only when you did not open an invite link: the code you were given, or the
  whole invite link, which the app reads the code from. An invite-only server needs it; elsewhere
  it says "(optional)". Under it the form says what the code does: "Invite to \<workspace\> from
  \<name\>. The new account joins it." for a workspace invite, "Invite to this server." for a
  server invite, or the server's reason when it refuses the code, such as an expired one. An
  invite to a workspace on another server (`rim-invite:1:…`) is joined after the account exists,
  with **Join with an invite code**.
- **Username**: 3 to 32 characters, lowercase letters, digits, `_` and `-`, free on this server.
  Capitals are folded to lowercase, so `Kuba` signs up as `kuba`. It cannot start with `r_` or
  `deleted-`. The form checks these rules before it sends anything and shows the username it will
  save, such as "Saved as kuba." With the server's domain it makes your handle (below).
- **Display name (optional)**: at most 64 characters. Left blank, your username is shown.
- **Name of this device**: up to 64 characters, filled in with the computer's name or, in a
  browser, a name such as "Firefox on Linux". It names this device in your device list.
- **I accept the terms of use**, with a link to the server's terms, only when the server has
  terms. The account is not created without it.
- **I am at least N**, only when the server asks for a minimum age: you confirm you are at least
  that old. Nothing else is checked, and no ID is asked for. The account is not created without
  it; if the server raised its age meanwhile, the box unticks and says so.

A server that holds as many accounts as it takes says "This server is full" instead of the form,
with a link to how to run your own server; sign up on another one, or run one. When the server
names where to report abuse, the sign-in and signup pages show it at the bottom.

Then choose **Create account**. In a browser the app first asks the browser to keep this site's
data; if the browser refuses, the app says your keys could be cleared with it and goes on only
after **Continue anyway**. On the public relay, without an invite code, the app then proves it is a
real device: "Proving this is a real device…" counts the seconds, with **Cancel**. It takes seconds
in the desktop app and can take tens of seconds in a browser.

**The recovery kit.** Once the account exists, the form says "Your account is ready." and shows
**Save your recovery kit**: your account id (`rimp1_…`) and a recovery phrase of 12 numbered
words. **Copy kit** copies both as text. Write the words down in order with the account id, or
keep the kit in a password manager, somewhere that is not this device. If you lose every device,
the kit is the only way back into the account, and anyone who has it can take the account over.

- **I saved it** confirms. The device then deletes its copy, and RIM cannot show the kit again.
- **Later** closes it. Until you confirm, the device keeps the kit and a bar across the top of the
  app says "Save your recovery kit. Losing this device's data can permanently remove your ability
  to manage this account.", with **Show recovery kit**.

**Where the keys live.** The device that created the account holds two keys: the identity key,
which adds and removes devices, and its device key, which signs in. The desktop app keeps them in
its secret vault, an encrypted file whose key is in the operating system's credential store
([Where the app keeps its data](install.md#where-the-app-keeps-its-data)). A browser keeps them
in this site's IndexedDB storage, as keys that cannot be exported: clearing the site's data
deletes them, and a private window may not keep them. The encrypted messages a browser reads stay
in that browser too, as **Set up encryption for this account** and Settings > Security say there;
the desktop app's history archive keeps a copy that lasts.

## Where you land

After signup the app opens one of these:

- **The invite's workspace**, when you signed up with a workspace invite. A server open to anyone
  takes no invite at signup, so there the app joins the workspace right after creating the
  account. If that fails, the form says "Your account is ready" and why it could not join, and
  **Continue** opens the app, where **Join with an invite code** takes the code again.
- **The server's default workspace**, when its operator named one. Every new account joins it as
  a Member and is in its public channels from the start.
- **Welcome to RIM** otherwise: "You don't belong to any workspaces yet.", with
  **+ Create workspace**, **Join with an invite code**, and "No invite yet? Ask a workspace's
  Owner for an invite link."

A server can hold a new account back for a while. A bar then says "New account: you can create
workspaces and message strangers after \<time\>."

**The direct space.** On a server that relays between servers, as the public relay does,
**Direct messages** at the top of the workspace rail opens your direct space. It holds the DMs and
groups that belong to no workspace, with people on this server or, through it, on other servers.
Its badge counts unread messages before you open it. The rail shows once a workspace is open.

## Join or create a workspace

- **Join with an invite link.** Opened in a browser while you are signed in, the link says "You
  have been invited to join \<workspace\>"; **Join workspace** joins it, and when you are already
  a member it says "You're already a member of \<workspace\>." with **Open \<workspace\>**. Signed
  out, it offers **Sign in as \<name\>** for each account this browser or computer holds keys
  for, or else a **Sign in** link that comes back to the invite, above the signup. A revoked,
  expired or unknown link says "This invite link is no longer valid. Ask the person who sent it
  for a new one." with **Go to RIM**. In the app,
  **Join with an invite code** on the welcome screen, or **Add workspace** (the **+** at the bottom
  of the workspace rail) and then **Join Existing**, takes the invite code: the whole invite link,
  the part of it that starts with `rim_inv_`, or a whole `rim-invite:1:…` link for a workspace on
  another server. **Join** opens it.
- **Join with a public link.** A workspace can have one permanent link, `…/join/rim_pjl_…`, that
  its Owner posts on a website or a profile. Opened in a browser, it shows the workspace's name.
  Signed in, **Join \<workspace\>** joins it and opens it; on a workspace that asks first,
  **Ask to join** takes an optional **Message** to the moderators (at most 500 characters) and the
  page says "Waiting for the moderators", with **Withdraw request**. When a moderator decides, the
  app tells you "Your request to join \<workspace\> was accepted." (the workspace appears in the
  rail) or "… was declined." (you can ask again after 24 hours), as your notification settings
  allow. Signed out, the page offers **Sign in** and **Create an account**: the link never
  creates an account, so that is the server's own signup, and once you are signed in the app
  opens the link again. A member is told "You're already a member" with **Open workspace**, and
  someone banned there "You are banned from this workspace.", with **Open RIM**. A wrong, old or switched-off link
  says "This link isn't valid.", the same in every case; after many of those from one network
  the page says how many minutes to wait. Pasted into **Add workspace**, the link opens the same
  page, and **Add workspace** lists your open requests under **Waiting for approval**, each with
  **Withdraw**.
- **Join with a public link of another server.** Your account joins workspaces on other servers
  too: paste their link into **Add workspace**, **Join Existing**, of your own app (the link's
  page says so under "I have an account on another server"). **Continue** looks the link up
  through your server and shows the workspace's name; **Join \<workspace\>** joins and opens it,
  and **Ask to join** sends the request with an optional **Message**, after which the dialog says
  "Waiting for the moderators of \<workspace\>. You'll be told when they decide." The request is
  listed under **Waiting for approval** with its server, without **Withdraw**: it cannot be
  withdrawn from your server and ends after 30 days. Once accepted, the app finishes the join
  and tells you, as for a request on your own server. A workspace whose Owner switched off
  accounts from other servers says so.
- **Create one.** **+ Create workspace** on the welcome screen, or **Add workspace**, then **Create
  New**, asks for a name. **Create** opens the new workspace with you as its Owner.

Every workspace member has one role:

- **Owner**: one per workspace, the person who created it. Can do everything, including inviting
  people and changing roles.
- **Moderator**: removes, bans and times out members, deletes any message, sets slow mode, handles
  reports and archives channels.
- **Member**: the role everyone who joins gets. Reads and writes in public channels, joins and
  creates channels, starts groups and adds people to conversations.
- **Guest**: sees and writes only in the conversations someone adds them to.

The Owner invites people with **Invite member** in a conversation's header: choose **Member** or
**Guest** under **Joins as**, how long the link lasts under **Expires after** (1 day, 7 days, the
default, or 30 days; no invite lasts longer), then **Generate invite link**, and send the link.
Up to 10 people can join with one link, fewer when the server's operator set a lower cap.
Settings → Workspace → **Invites** lists every invite of the workspace to its Owner, newest
first: its role, how many of its uses are taken, when it expires and who created it, marked
Active, Expired, Used up or Revoked. **Revoke** on an active invite, after its confirmation,
stops the link admitting anyone; people who already joined with it stay. **Create invite** there
opens the same dialog.

Settings → Workspace → **Public link**, for the Owner only and not in the server's default
workspace, sets up the workspace's permanent link. It lets people who already have an account
join or ask to join, and never creates an account. **Accounts from other servers can join**, on
by default, lets people whose account is on another server use the link from their own app;
off, the link is for accounts of this server only. The first time the switch turns it
on, the app asks again: "Anyone with this link can join. Post it only where you want it public."
The switch only pauses the link: "Turning the link off pauses it. Turning it on again brings back
the same link." Off, the link says "This link isn't valid."; on again, it works wherever it was
posted. **Mode** is **Join directly** or **Ask to join**, and **Role** is **Member** or **Guest**.
While the link is on it shows with a copy button, and a line reads "N joined in the last 24
hours · M in the last 7 days · K requests waiting". **Issue a new link**, after the confirmation
"The current link stops working everywhere you posted it.", ends the current link at once;
people who joined with it stay, and open requests stay open.

**Creating a channel.** **New channel** (the **+** beside Channels in the tool panel, or
<kbd>Ctrl+Shift+C</kbd>) asks for a **Channel name**. The **Private** switch says "Only invited
members can see this channel. This cannot be changed later." **Add members (optional)** picks
people to add, and **Create** opens the channel. **Browse channels**, the compass beside
**New channel**, lists the public channels you can join. In the server's default workspace only
its Owner and Moderators create channels, and only they see **New channel**.

A channel's topic under its name is changed by the Owner and Moderators, and in a private
channel by its creator; everyone else reads it.

## Talk

**Channels.** A public channel is readable by every member of the workspace. The tool panel lists
the channels you joined; one you have not joined shows **Join channel** above its timeline.

**Threads.** Replies live in threads. Hover a message and choose **Open thread**, choose **Reply
in thread** in its context menu (right-click), or select it and press <kbd>r</kbd> or <kbd>t</kbd>.
The thread opens in a pane on the right; the message stays in the timeline and its replies stay in
the thread. A message with a thread shows how many replies it has under it (**3 replies**), or
**View thread** on a server that does not report the count; choose it, or **Open thread** on
hover, to open the pane. The thread's reply box works like the composer: `@` mentions, `:` emoji,
**Insert emoji** and **Attach file**. Commands with `/` run from the conversation's composer only.

**DMs and groups.** **New message** (the **+** at the top of the tool panel, or
<kbd>Ctrl+Shift+G</kbd>) lists the workspace's members. Pick one person for a DM or several for a
group, then choose **Start conversation** or **Start group** (or press <kbd>Ctrl+Enter</kbd>). A
DM opens as a draft and is created when you send its first message. A group is named
after the people in it, as you see them: "Alice and Bob", or "Alice, Bob, Carol and 2 others"
past three. In Direct messages
the picker lists your contacts instead. Settings > Contacts shows your contact link and adds
someone from theirs; a workspace's member list has **Add as contact**.

**DM requests.** A first DM from someone can arrive as a request, which you see before the
conversation joins your list. Settings > Direct messages decides who reaches you how:

- **Outside your workspaces**: **Requests** (the default) or **Nobody**. The server's operator or
  a workspace can turn requests from outside off for you.
- **Members of your workspaces**: **Direct** (the default) or **Requests**, per workspace.
- Your contacts, and the Owner and Moderators of a workspace you share, always reach you directly.

Requests sit at the top of Notifications, and the bell counts them. "Requests (n)" also heads the
conversation list of the workspace they came from, or the Direct messages list for those from
outside. Each request shows the sender's verified name and fingerprint, with **Accept**, **Read
first**, **Ignore**, **Block** and **Report**. **Block** asks first; the person is not told.
Settings > Direct messages lists the people you blocked under **Blocked people**, each with
**Unblock**. **Read first** opens the conversation without deciding: in place of the composer it
says who wants to message you, with **Accept**, **Ignore**, **Block** and **Report**. You reply
once you accept; until then the sender sees nothing from you, not even that you read it. The
sender sees "Sent as a request; \<name\> has not accepted yet." above their composer. rim-server's
[Messaging](../../rim-server/docs/messaging.md#who-may-start-a-dm) has the full rules.

**Reactions.** Hover a message and choose **Add reaction** to pick an emoji. Clicking a reaction
under a message adds or removes yours.

**Mentions.** Type `@` and the start of a name, then pick the person from the list. They get a
notification when they can read the conversation. Typing someone's whole handle, such as
`@ada:example.org`, mentions them too once the app knows it.

**Handles.** Everyone has a handle, `@username:domain`: their username at their server and that
server's domain, such as `@kuba:rim-platform.org`. People of your own server are shown as
`@username`, people from other servers with their domain. **Copy @username** copies the whole
handle, which names the person on any server. The app learns the handle of someone from another
server from their messages; until then their card shows no handle, only their name.

**The composer.** "Write a message..." takes Markdown. An image from another site shows as a link
marked "image": the app loads images only from its own server. A single line break shows as one.
Besides bold, italics, code, lists, quotes and links, a message can hold ~~strikethrough~~, tables,
horizontal rules (`---`) and task lists (`- [ ]`, `- [x]`), whose boxes are read-only.
<kbd>Enter</kbd> sends and <kbd>Shift+Enter</kbd> starts a new line. `/` at the start lists
commands, and `:` followed by the start of a name suggests emoji. A workspace's custom emoji
written as `:name:` show as their images. **Insert emoji** and **Attach file** sit beside the
field; a server can turn attachments off. <kbd>Escape</kbd> moves from the composer to the message
list, where the arrow keys move between messages and <kbd>e</kbd> edits your own.

**Inbox and notifications.** **Inbox** on the side rail shows the conversation list in the tool
panel, with the number of unread messages in the open workspace. The bell, **Notifications**,
lists your mentions, DMs, thread replies, reactions and keyword matches in the open workspace,
under any message requests; **Mark all read** clears them. Settings > Notifications sets what
notifies you in the workspace and how this device shows it: sound, the **Message preview**
(sender and text, sender only, or nothing, which hides who and where too), the **Title**
(the conversation, the sender, or both), and **Hide text of encrypted messages**. An example
under the settings shows the result.

## Find your way around

From left to right:

- **Workspace rail**: **Direct messages**, one button per workspace with its unread count, and
  **Add workspace** at the bottom.
- **Side rail**: **Inbox**, **Plugins**, **Notifications** and **Search workspace**, then
  **Audit log**, **Settings** and your avatar, whose menu has **Set status...**, **Settings** and
  **Sign out**.
- **Tool panel**: Conversations, with Channels, archived channels and your DMs and groups, and
  **Workspace members** and **New message** at the top. Notifications and member lists take its
  place while open.
- **Main surface**: the conversation's header, timeline and composer. Settings, message requests
  and some plugin panels take its place, and a thread opens in a pane to its right.

A person has one menu wherever they appear: right-click their name or avatar on a message, an
@mention of them, or their row in a conversation's members or in **Workspace members** (the row's
**⋮** button opens the same menu). It offers **View profile**, **Send message** and
**Copy @username**, adds them to or removes them from your contacts, and in a conversation's
members, to an Owner or Moderator, **Remove from** the conversation. An Owner or Moderator who
may act on them also gets a **Moderation** section: **Change role**, **Time out** (10 minutes,
1 hour, 1 day, 1 week or a custom end) or **Clear timeout**, **Kick…** and **Ban…**, each behind its
confirmation. On yourself the menu has **View profile**, **Set status…**, **Copy @username** and
**Settings**.

Right-click a workspace, a conversation or a section heading of the sidebar for its actions;
the conversation's are also under **…** in its header.

The keys that matter on the first day, as a new device has them:

| Keys | What they do |
|---|---|
| <kbd>Ctrl+K</kbd> | Open the command palette |
| <kbd>Ctrl+Shift+F</kbd> | Search the workspace |
| <kbd>Ctrl+F</kbd> | Search in this conversation |
| <kbd>Ctrl+Shift+G</kbd> | New message |
| <kbd>Ctrl+Shift+C</kbd> | Create a channel |
| <kbd>Alt+ArrowUp</kbd>, <kbd>Alt+ArrowDown</kbd> | Previous or next conversation |
| <kbd>Ctrl+E</kbd> | Focus the composer |
| <kbd>Escape</kbd> | Close the open panel |
| <kbd>?</kbd> or <kbd>Ctrl+/</kbd> | Show the keyboard shortcuts |

On a Mac, <kbd>Cmd</kbd> works wherever <kbd>Ctrl</kbd> is written. The command palette ("Type a
command...") lists every command you can run here, built in, from a plugin or your own, with its
keybind. Search takes filters such as `from:@user` (or a whole handle, `from:@user:domain`),
`in:#channel`, `has:link` and
`before:2026-01-01`. The shortcuts panel lists the bindings as they stand; Settings > Keybinds and
Settings > Keyboard change them, and [Keyboard](keyboard.md) explains profiles and the Vim layer.

**Plugins** on the side rail opens a menu of the panels of your running plugins, or **Manage
plugins** when none has a panel. [Plugins](plugins.md) covers installing and trusting one, and
[UI shell](ui-shell.md) describes the shell's design.

## Keep your account safe

- **Save the recovery phrase.** If you chose **Later**, **Show recovery kit** in the bar at the
  top of the app shows it again until you confirm.
- **Link a second device.** A device that holds the identity key shows **Link a device** in
  Settings > Security, with a QR code and a text code. On the new device's sign-in page, choose
  "Have another device signed in? Link this device with its code" (in a browser, "Signed in on the
  desktop app? Link this browser with its code"), paste the text code, name the device and choose
  **Link this device**. Check that the first device shows the same fingerprint, then choose
  **Confirm** there. The new device gets a key of its own and signs in with it; managing devices
  stays with the device that holds the identity key. [Device linking](device-linking-desktop.md) and
  [The web app as a linked device](web-linked-device.md) have the details.
- **Back up the identity key** (desktop app). With the history archive set up in
  Settings > History, the computer that holds the identity key keeps a sealed copy of it there,
  which Settings > Security reports under **Identity key backup**. Another of your computers can
  then choose **Take over the identity key...** and type the recovery phrase
  ([Identity key backup](identity-key-backup.md)). An identity key held by a browser is never
  backed up.

When a device is lost:

1. **You still have the device with the identity key.** In Settings > Security, under Devices,
   choose **Remove** beside the lost one, then **Remove device**. It is signed out at once and its
   key never signs in again.
2. **You lost the device with the identity key, but another computer of yours has the backup.**
   Take the identity key over there, then remove the lost device.
3. **You lost every device.** On the sign-in page, choose "Lost your devices? Recover an account
   with its recovery kit". Paste the kit or type the phrase, check the account id, name the device
   and choose **Recover account**. The device becomes your account's new device with a new
   identity key, and every other device and session is signed out. Recovery gives back the
   account, not its encrypted messages: those come back only from the history archive.

## Next

- [Plugins](plugins.md): the official plugins, and installing, using, trusting and removing one.
- [End-to-end encrypted DMs and groups on the desktop](e2ee-desktop.md), and
  [in the web app](e2ee-web.md): channels are never end-to-end encrypted, DMs and groups can be.
- [Self-hosting](../../rim-server/docs/self-hosting.md): running your own server, including a
  default workspace for new accounts.
