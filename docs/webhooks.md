# Post alerts from other services

A webhook is a web address that posts into one channel. Give it to GitHub, Grafana, a backup
script or any service that can call a URL, and what the service sends shows up in the channel as
a message. Nothing has to run on your side.

This page shows how to set one up. It's for a workspace's Owner or a Moderator. The full reference
is [Bots in the client](bots.md) and rim-server's [Bots](../../rim-server/docs/bots.md).

## Keep the URL secret

**Anyone who has the URL can post to that channel.** RIM checks no password or signature on what
arrives, so the URL itself is the key. Treat it like a password:

- Paste it only into the service that should post.
- Don't post it in a chat, a ticket or a public repository.
- If it leaks, revoke the webhook and make a new one. The old URL stops working at once.

A post from a webhook can't mention people: `@channel`, `@here` and mentions of a person arrive as
plain text.

## Before you start

- You're the workspace's **Owner or a Moderator**.
- The workspace has a **bot**. Every webhook posts as a bot, so the channel shows who posted. Make
  one in **Settings > Bots** with **New bot**: give it a name, say **Who runs it** and **Where what
  it reads goes**. Everyone in the workspace sees those two lines.
- The channel is **not encrypted and not archived**. Encrypted channels can't have webhooks.
- A channel has **one webhook at a time**.

Your server must support bots and webhooks. If you don't see the options below, it doesn't, or its
operator switched them off.

## Make a webhook

There are two ways in:

- **From the channel:** open the channel's menu (right-click it in the list, or **…** in its header)
  and choose **New webhook…**. The channel is filled in for you.
- **From Settings:** **Settings > Bots**, then **New webhook** under **Incoming webhooks**, and
  choose the channel.

Then choose the bot and a **Format**, and press **Create webhook**. The bot joins the channel if it
isn't in it yet.

The next dialog shows the URL **once**. Copy it, then press **Done**. RIM keeps only a fingerprint
of it, so it can't show it again. If you lose it, revoke the webhook and make another.

## Choose a format

The format decides what a delivery posts.

- **Plain.** The service sends JSON with a `text` field, and that text is posted. Good for your own
  scripts:

  ```sh
  curl -H 'Content-Type: application/json' -d '{"text":"The deploy is **done**."}' \
    "https://rim.example/api/hooks/rimhook_…"
  ```

- **GitHub.** Posts new releases, pull requests opened, closed or merged, and issues opened or
  closed, one line each with a link. In the repository, open **Settings > Webhooks > Add webhook**.
  Paste the URL as the **Payload URL**, choose `application/json`, and leave **Secret** empty. Under
  events, pick **Releases**, **Pull requests** and **Issues**. Other events post nothing.
- **Grafana.** Posts firing and resolved alerts with the alert's name and summary. In Grafana, open
  **Alerting > Contact points**, add a **Webhook** integration, paste the URL and choose the method
  `POST`.
- **Custom.** You write the rules yourself. See the next section.

A GitHub webhook you leave as it is gets RIM's fixes to that format with each release. Grafana's, a
custom one, and a GitHub one you've edited are copies that belong to the webhook, so they stay as
they are.

## Write your own format

Choose **Custom** and press **Write the format**, or **Edit format** on a webhook's row in
**Settings > Bots**. Editing keeps the same URL, so nothing changes in the service.

A format is a list of **rules**. The first rule that holds decides the post:

- **When:** conditions such as "the field `status` equals `failed`". Each is a **Field** of the JSON
  body or a **Header** whose name starts with `x-`, and what it must equal, exactly. A rule with no
  conditions always holds.
- **Post:** the text, with `{field}` placeholders such as `{host}` or `{alerts.0.labels.alertname}`.
  Markdown works. **Insert a field** offers the fields of your sample.
- **Link** (optional): a link added after the text, only if it starts with the address you give.

**Start from** copies a ready-made format, GitHub or Grafana, with its sample, if you'd rather edit
than start blank.

If no rule holds, nothing is posted. A condition chooses what to post; it doesn't keep anyone out,
since anyone with the URL can send any header. Don't put secrets in a format: every Owner and
Moderator of the workspace can read it.

### Try it

**Try it** takes headers, one `Name: value` per line, and a body. It tells you which rule matches
and shows the message as it would look, or why nothing would post. Trying posts nothing.

### See what a service really sends

Writing a format is easiest against a real delivery:

- **For a new webhook, Start test URL** gives a URL that posts nothing. Paste it into the service
  and send a test from there. When you save, the webhook keeps that same URL, so you don't have to
  change the service again.
- **For an existing webhook, Listen** shows what reaches it, while it keeps posting as before.

Each delivery appears in a list, newest first, with what your format would do with it. Open one to
see its headers and body, and **Use as sample** to load it into Try it. If a body arrives
form-encoded, set the service to send `application/json`.

What arrives is held on the server in memory for a short while, at most an hour. Only you can see
it, and closing the editor ends it.

### Build with AI

**Build with AI** drafts the rules for you from a sentence, such as "One line when a backup fails,
with the host and the reason", and the sample in Try it.

- In the desktop app, with your own AI key set up ([The AI agent](ai-agent.md)), it asks your model
  directly. It says what it will send, and to which provider, before anything is sent. RIM runs no
  model of its own.
- In the web app, or without a key, **Copy prompt** copies the same request for any AI you like.
  Bring the answer back with **Paste JSON**.

The answer is only a draft. RIM checks it against the sample, and nothing is saved until you press
**Create webhook** or **Save format**.

**Copy as JSON** and **Paste JSON** also let you share a format with another webhook or workspace.

## Look after your webhooks

**Settings > Bots** lists each webhook with its channel, bot, format and when it was last used. A
webhook with a ready-made format other than GitHub, or one you edited, shows as Custom.

- **Edit format** changes what it posts. The URL stays the same.
- **Revoke** stops the URL at once. Then you can make a new webhook for the channel.
- **Deactivating the bot** stops all of its webhooks.

A webhook takes at most 30 calls a minute. Calls past that post nothing.

## What a webhook can't do

- **Read anything.** It only posts. It can't see the channel or call the service back.
- **Post in encrypted conversations,** direct messages or groups.
- **Check who sent a delivery.** Whoever has the URL can post. That's why it must stay secret.

For a bot that reads, reacts or answers, use the bot API in rim-server's
[Bots](../../rim-server/docs/bots.md).

## Next

- [Bots in the client](bots.md): how bots are marked, and everything in Settings > Bots.
- [Connect an AI agent](agents.md): letting a program on your computer read and post, with your
  approval.
- [Commands and automation](commands-and-automation.md): pipelines that post as a bot.
