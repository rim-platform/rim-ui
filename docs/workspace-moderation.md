# Workspace removals and bans

A removal notice shows the workspace name, cause, end date and reason sent for this account.
It remains visible across reloads until dismissed, scoped to the server and signed-in account.
Moderators are told that the member will see the reason they enter.

Message authors retain their readable names. Active bans have a muted marker; hover cards
show a reason only when the server grants access to it. Ban changes refresh author views,
and temporary markers clear when the ban expires.

In direct messages, local accounts missing the configured default workspace can choose
“Join the default workspace”. Active bans still prevent joining. An explicit unban restores
local membership in the current default workspace and its public channels; other workspaces
still require an invitation.

Deploy the corresponding server update before this client. Older servers reject the new
message-author ban fields, so message queries require a server that provides them.

# Join requests

A workspace whose public link is set to **Ask to join** collects requests. Settings → Moderation
→ **Join requests**, for the Owner and the Moderators, lists the open ones newest first, with
**Load more** for older ones: the person, their message, when they asked and when the request
expires (30 days after it was filed). **Accept** adds them with the link's current role;
**Decline** closes the request, and the person can ask again after 24 hours. A count of open requests shows on the Moderation entry in Settings and, as **Join
requests…**, in the workspace's menu on the rail. Lists and counts refresh when a request is
filed or decided, by anyone, while the workspace is open. The direct space and the server's
default workspace have no public link and no join requests.

The person is told when their request is accepted or declined, through the direct space's
connection, since they are not a member yet; a withdrawn request, or one a ban cancelled, is not
announced.


# Flagged messages

A server that lists `message_flag` in `serverInfo.capabilities` checks the messages it can read
for sexual text art and flags those that score high. The client covers a flagged message's
text, attachments and link previews with "Hidden: the automatic check flagged this message."
and **Show anyway**; the author line, the reply quote, the reactions and the thread summary stay
visible. Show anyway uncovers the message for this viewer for the rest of the session, under the
label "Flagged by the automatic check" with **Hide** to cover it again. A message being edited is
not covered.

The workspace's Owner and Moderators also get **Clear flag**, on the cover and on the label: it
clears the flag for everyone, and the message shows uncovered for every reader as soon as the
server announces it. Each flag the check sets files a report, which Settings → Moderation lists
with **Automatic check** as the reporter. The reported text is covered there too, with **Show
anyway**, and once shown it keeps its lines unwrapped and folds when tall, so the drawing reads
as drawn. Against an older server nothing is covered and the reports list is unchanged.

# Deleting a person's messages

An Owner or a Moderator can delete one person's messages in the workspace's channels, thread
replies included, in one go:

- **While banning.** The ban dialog asks **Delete their messages from:** with **Don't delete**
  (the default), **Last hour**, **Last 24 hours**, **Last 7 days** and **Everything**.
- **Delete messages…** in the person's menu, in the Moderation section before **Kick…** and
  **Ban…**. Its dialog starts on **Last hour** and has no **Don't delete**. It is also offered on
  someone who has left the workspace, as the only moderation item, and on each row of Settings →
  Moderation → **Bans**, since a banned person is in no member list any more.

Before anything is deleted the dialog counts the chosen period, for example "38 messages in 3
channels", and the confirm button names the total ("Ban and delete 42 messages", "Delete 42
messages"). Messages in private channels you are not a member of are counted apart, as numbers
only, with a checkbox **Also private channels you're not in** that is checked by default and
shown only when those channels hold any of them. A period with nothing in it says "Nothing to
delete."; the ban dialog then only bans, and the Delete messages dialog cannot be confirmed.

Direct messages, groups, encrypted channels and archived channels are never touched. Deleted
messages read as deleted for everyone, as after a single delete, and their pins and unread
notifications go with them.

The ban dialog bans first and deletes after. When the ban fails nothing is deleted and the dialog
offers Retry; when the ban goes through but the delete fails, the dialog closes and says
"Banned … but deleting their messages failed" with the server's reason.

The server deletes at most 1,000 messages per call; the client calls again while more remain,
up to 50,000 messages per run. When more remain after that, it says so: run **Delete messages…**
again.

Against a server that does not list `delete_member_messages` in `serverInfo.capabilities`, none of
this shows: the ban dialog has no message choice and the menus and the bans list have no
**Delete messages…**.
