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
**Decline**, after a confirmation, closes the request, and the person can ask again after 24
hours. A count of open requests shows on the Moderation entry in Settings and, as **Join
requests…**, in the workspace's menu on the rail. Lists and counts refresh when a request is
filed or decided, by anyone, while the workspace is open. The direct space and the server's
default workspace have no public link and no join requests.

The person is told when their request is accepted or declined, through the direct space's
connection, since they are not a member yet; a withdrawn request, or one a ban cancelled, is not
announced.

