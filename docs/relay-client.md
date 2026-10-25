# Relays: the client

The app talks only to its own server, its **relay**. A DM or group homed on another relay (its
creator's), and a workspace hosted elsewhere, is reached through the relay: requests are
signed by this device and forwarded unchanged, answers and pushed events are signed by the host
and checked here against the host's key, pinned on first use. The contract is rim-server
`docs/specs/server-to-server-v1.md`; this document says how the desktop and the web app
implement their side of it.

Everything here switches on when the server answers `relayInfo`. A server without it runs exactly
as before.

## What lives where

| Where | What |
|---|---|
| `src/features/relay/api/documents.ts` | Every GraphQL document of the relay (`relayInfo`, `remoteServer`, `remoteIdentity`, contacts, `dmRequests` and its mutations, `relayItems`, `ackRelayItems`, `streamHeads`, the `relayStream` subscription, a conversation's predecessor) |
| `src/features/relay/crypto/serverStatements.ts` | The statements in the browser: server key log replay, descriptor, discovery document, device request, host response, host event |
| `src/features/relay/crypto/relayCrypto.ts` | The same work per platform: the Tauri `relay_*` commands and `key_identity_sign_device_request` on the desktop, WebCrypto and the browser's device key in the web app |
| `src-tauri/src/relay/` | The desktop's checks of server statements (`server.rs`) and their commands |
| `src-tauri/src/key_identity/statement.rs` | `device_request`: the payload in the spec's field order, signed by the device key; `verified_card` |
| `src/features/relay/state/` | `relayDb.ts` (IndexedDB `rim-relay`), `serverPins.ts`, `spaces.ts` (which space lives on which host), `useRelayStore.ts`, `serverOrigin.ts` (the origin this app's server is known by) |
| `src/features/relay/transport/` | `remoteFetch.ts` (signed requests, verified answers), `requestSeq.ts`, `relayHealth.ts` |
| `src/features/relay/stream/` | `relayStream.ts` (the queue on the WebSocket), `sequencer.ts`, `streamRules.ts` |
| `src/features/relay/contacts/` | Contact links, fingerprints, verified identities, aliases, relays seen in invites |
| `src/features/relay/inbox/autoAccept.ts`, `inbox/requestWorkspace.ts`, `components/DmRequestInbox.tsx`, `components/DmRequestsPage.tsx`, `components/DmRequestsRow.tsx` | Message requests |
| `src/features/dm-policy/` | Who may start a DM: the person's settings, a workspace's policy, the operator's settings in About |
| `src/features/relay/conversations/` | New DMs and groups in the direct space, successors |
| `src/features/relay/runtime/relayRuntime.ts` | Start-up and wiring (`useRelayRuntime`, mounted in `AppShell`) |
| `src/features/relay/runtime/useDirectSpaceRuntime.ts` | This relay's direct space from sign-in (`useDirectSpaceRuntime`, mounted in `AppShell`) |
| `src/features/relay/remote/` | Workspaces on other servers: invite links, joining, delegations and their renewal, the relay's own key, a revocation's fan-out, switching relays |
| `src/features/relay/direct/` | Talking to a server directly: the transport (`directTransport.ts`), GraphQL over it, the socket shim for `graphql-ws`, the direct connection and its runtime, one-off calls |
| `src-tauri/src/relay/direct.rs` | The desktop's direct sessions: discovery fetches, GraphQL with each server's own cookie jar, WebSockets with that cookie |
| `src/features/relay/pow/`, `src-tauri/src/relay/pow.rs` | The signup proof-of-work: reading a relay's registration mode, the search in a web worker and on the desktop's cores |
| `src/core/graphql/client.ts` | `setSpaceRouter`: the GraphQL client's `fetch` sends a request about a space elsewhere to its host |
| `src/core/graphql/config.ts` | `setRelayEndpoint`: the relay the desktop moved to after a switch |
| `protocol/relay-vectors.json` | Known answers both platforms reproduce, including the delegation and the revocation acknowledgement and their conformance cases |
| `protocol/pow-vectors.json` | Proof-of-work known answers both platforms find, and a relay descriptor in `pow` mode |

## This server's address

The app sends its requests to its **transport origin** (`getApiOrigin`): on the desktop the
configured server, in the web app the server the page came from (`/api` on the page's origin).
Other servers and people know the server by its **identity origin**, which the cards, links and
pins name. The two differ when a deployment serves the web app on a domain of its own while the
server keeps its name: the web app at `https://chat.example`, the server at
`https://relay.example`, the first passing `/api`, `/api/ws` and `/.well-known/rim-server` to the
second.

`state/serverOrigin.ts` reads the identity origin. The desktop takes its configured server and
fetches nothing. The web app fetches the discovery document from the transport origin, without
following redirects, so only the page's own server can answer it. It takes the origin that the
descriptor's `endpoints.s2s` is at (with `/s2s/v1` taken off), or the transport origin when
server-to-server traffic is off, and verifies the document against that origin as it verifies
any server's: the log replays, the descriptor verifies under the head key, and its
server-to-server endpoint lives at the origin. The answer is kept for the page. When both are the
same origin, as with one domain for the web app and the server, nothing changes.

The identity origin is what these use:

- the relays a profile card lists, and whether a published card is stale (`profileCardRelays`,
  `profileCardIsStale`); a card is neither checked nor published until the origin is known;
- the contact link and its QR code (Settings > Contacts);
- "this server" in the card's relay list (Settings > Security);
- the relay's own pin and key hash for delegations (`remote/relaySelf.ts`);
- the old relay of a relay switch (`beginSwitch`);
- the relay a member without relays is given, and whether a member is on this relay, when a DM
  starts (`conversations/startDirect.ts`);
- the signup's registration mode and proof-of-work (`pow/proofOfWork.ts` `readRegistration`);
- the endpoint a device-link code names, as the identity origin's `/api` when it is not the
  page's, and a code naming that endpoint is taken as well as the page's own
  (`serverEndpoint`, `web-linked-device.md`);
- the host shown in About and in Delete account.

What the app sends stays on the transport origin: GraphQL, the WebSocket, uploads, attachments,
plugin bundles, `/api/remote/…`. So does the login proof's `audience`, the page's host, which the
server must list in `RIM_KEY_LOGIN_AUDIENCES` when it is not the server's own. Links that open
the web app (an invite from **Invite people**) use the page's origin, where the web app is.
When the identity origin cannot be read, the contact link and the card's relay list say so
instead of showing the page's origin, and the host shown falls back to the page's.

## Server pins

A server is pinned the first time the app needs it: the home of a DM someone else started (from
the relays of the inviter's card), a contact's relay. `remoteServer(origin)` fetches the
discovery document through the relay; the app replays the log, checks that its inception hashes
to the expected server id, verifies the descriptor under the head key and that its server-to-server
endpoint is at that origin, and stores the log (`servers`). The app's own server, the one it is
signed in to (`info.serverId`), is pinned from its own discovery document instead, fetched
directly from the origin the app talks to (`readOwnDiscovery`) and checked the same way: asking
it for itself through `remoteServer` would need the server to reach its own public address,
which a server behind NAT or on a local domain may not. This is the pin a request from someone on
the same server needs, and the one a key rotation of this server refreshes.

Both verifiers (`serverStatements.ts` in the browser, `src-tauri/src/relay/server.rs` on the
desktop) read the descriptor as strictly as its signature: a field they do not know refuses it.
They know the two optional fields a server signs when its operator sets them, and check them as
rim-server's `rim_s2s` does: `handleDomain` (before `issuedAt`), the domain of the server's
handles, a lowercase DNS name of at most 253 bytes with labels of 1 to 63 letters, digits and
hyphens, no leading or trailing hyphen and no trailing dot; and `abuseContact` (last), where to
report abuse, 1 to 512 bytes and not only whitespace. A descriptor without them verifies as
before; both come back as `handleDomain` and `abuseContact`, `null` when absent. The discovery
document's unsigned fields beside the descriptor (`features`, `registration`) do not refuse it:
neither verifier reads them, and `registration.full` is read apart (below).

A later fetch must extend the pin. An equal log refreshes the descriptor version; a prefix keeps
the pin; an extension is taken, and after a `signer: server` rotation the key before the head
still verifies for 24 hours from when this app took it (never after a `signer: recovery` one,
nor on a first pin). Anything else is a fork: the pin is marked, the app stops using the server
and says "This server's identity changed in a way RIM cannot verify". A statement signed at a
`keySeq` above the pin refetches the server once (at most once a minute) and accepts only an
extension.

## Requests to a space elsewhere

`spaces` binds each space id this account uses elsewhere to one host, for good: an id this relay
uses for a space of its own or another host already holds is refused, so every cache entry keyed
by space id stays unambiguous.

The GraphQL client reads a request's `serverId` or `workspaceId` (or that field of `input`). For
a space bound to a host it sends the exact body to `/api/remote/<host server id>/api` with:

- `Rim-Device-Request`: the base64url of a `device-request` payload (method, host-relative path,
  `seq`, the body's SHA-256), and `Rim-Device-Signature`: its signature by this device's key;
- the session cookie and `X-CSRF-Token`, as for any request to the relay.

`seq` is `max(previous + 1, Unix time in µs)`, written to IndexedDB per (device, host) before the
request is signed, one at a time per host. The answer must carry `Rim-Host-Response` and
`Rim-Host-Signature`: a `host-response` signed by the host's key at its `keySeq`, naming the host,
the SHA-256 of this request's payload, the status received and the SHA-256 of the body
received. An answer without them, or one that does not verify, is a relay failure, never an
answer. A verified `409 {"error":"replay","highestSeq":…}` moves the counter above `highestSeq`
and signs once more.

Calls that name no space but belong to a host (`myMlsWelcomes`, `ackMlsWelcomes`) go through
`hostClient(host)`; encrypted attachments of such a space are uploaded (as the exact multipart
bytes) and downloaded the same way. Each host's failures are recorded (`relayHealth.ts`, kept
across restarts) for "the home is gone".

## The relay stream

`relayStream(after)` runs on the existing WebSocket beside `workspaceEvents`, from the last item
acknowledged. For each `RelayItem` the app:

1. reads the envelope and checks that it names the item's host and space;
2. accepts it only for a space bound to that host, or for a `DmInvite` on this person's own
   stream (`u:<principal id>`), which binds its space (pinning the host from the inviter's
   card's relays first);
3. checks the signature under the pinned key at `keySeq` and that the stream fits the event
   (`c:<conversation id>` its conversation's events, `u:` this person's, `w` space-wide events,
   `e` typing and presence without a `seq`);
4. orders it per `(host, space, stream)`: at or below the last applied it is a duplicate, the
   next one is applied, a later one is held. The first event seen, or a stored `last`, is the
   baseline. After 30 seconds or 256 held events the app reconciles: `streamHeads` through the
   host, a refetch of the space's lists and change feed (all host-signed answers), `last` moved
   to the head and what is held above it applied. If that fails the app shows "Messages may be
   missing from <space>" with a retry and "Connect directly" (see "Direct connection");
5. applies it through the same handler as `workspaceEvents` (`applyWorkspaceEvent`);
6. acknowledges (`ackRelayItems`) every item up to the first still held, and stores that cursor.

`DmRequestReceived` refreshes the request inbox; `QueueOverflow` reconciles the spaces it names;
`RevocationAcked` refreshes the revocation fan-out (the app reads its acknowledgements from
`deviceRevocationStatus`, whatever the notice carries). `workspaceEvents` is not opened for a
space elsewhere.

## Profile card and contacts

Settings > Security edits the card's relays, preferred first; this server stays on the list, and
the card is signed and published again on change. A card that no longer lists this server is
stale.

A contact link is `rim-contact:1:<principal id>:<relay URL>`, shown as text and as a QR code
(level M; the link has lower-case letters, so the encoder uses byte mode). Settings > Contacts
reads a pasted link, or a scanned one where the browser has `BarcodeDetector` and a camera, and
shows the name from the person's verified card and their fingerprint before `addContact`. A
member of a shared workspace has "Add as contact" in the member list. Everything shown about a
person comes from `remoteIdentity`: the key log replayed against the principal id and the card
verified against its head (`relay_verify_card` on the desktop). Names given to contacts are kept
on this device (`aliases`) and win over card names everywhere members are named.

The fingerprint of a principal is
`base32(first 10 bytes of SHA-256("rim.principal-fingerprint.v1\0" || principal id))`, shown as
four groups of four characters.

## The direct space and DMs across relays

"Direct messages" at the top of the workspace rail opens this relay's direct space. Its list
merges the DMs and groups of every direct space this account uses (this relay's, and those of
relays where someone started a conversation with this person); opening one switches to its space.

This relay's direct space is live from sign-in, whichever space is open: once `relayInfo`
answers, the app loads its unread counts and unread notification count, subscribes to its
`workspaceEvents` and shows the notifications the server sends there, so the Direct messages
entry carries its unread badge before it is opened. A reconnect restores that subscription as it
does the open space's, and the open space's own subscription leaves the direct space alone, so
each of its events applies once. The app sends no workspace-only query about a direct space: no
custom emoji, workspace plugins, pipelines, workspace state or channels, and keybinds are asked
for without a workspace. Settings hides Pipelines, State and Emoji there.

New DMs and groups start in this relay's direct space whenever every member has a principal id:
from the contact picker there, or from a workspace's member picker when everyone picked has one.
A group is created when it is picked; a DM opens as a draft and is created when its first
message is sent, unless the side rail already lists one with that person.
`createConversation` names them in `remoteMembers` with the relays of their verified card. With
anyone on another relay the conversation is created end-to-end encrypted, which needs every
member and this device to be set up for encryption; otherwise nothing is created and the picker
(for a DM, the composer) says who is not ready. With members of this relay alone, today's rule holds. MLS runs unchanged:
the home claims key packages, and the device directory fetches any principal its relay cannot
answer for (`principalDevices`, `keyLog`) with `remoteIdentity`, from their contact entry or the
relays their invite named, with the card checked against the log and the same head pin and
revocation memory as any other principal (`e2ee_peer`, `peers`).

When a DM's home has failed for 7 days, the conversation offers "Continue here": a successor in
this relay's direct space with the same members and `predecessor`. The list shows a conversation
continued elsewhere once, as its successor; of two successors of one conversation the one with
the smaller id (UUID v7, so the earlier) is kept and the app leaves the other. Each part links
to the other at the top of its timeline.

## Message requests

Pending `dmRequests` sit above the notifications, counted on the bell. Each shows the name from
the request's card, verified against the sender's key log, and the fingerprint. "Read first"
verifies the held `DmInvite`, binds the space, processes the Welcome and opens the conversation,
whose composer gives way to the request's decision (`DmRequestBar`: Accept, Ignore, Block and
Report; Ignore and Block close its view) while the request is pending. The server
refuses posts, reactions and typing from the recipient there until they accept (rim-server
`docs/relay.md`, "The request inbox"), and the bar keeps a reply to a request hosted elsewhere
from being sent at all;
Accept, Ignore, Block (which also leaves the conversation through its home) and Report act on the
relay. Accepting then catches the conversation up: while the request was pending its events never
reached the account, so nothing synced what the sender wrote meanwhile; the app processes any
Welcome, asks the change feed for the conversation and refreshes its timeline. A request from someone on this server invites to one of its own spaces (its direct space or
a workspace of the account), which is never bound as a remote space: when verifying held items,
such a space counts as hosted by this server (`localSpaceHost`), so only an invite whose host is
this server's id and whose envelope its key signed verifies. An invite from another host that
names one of these spaces is still dropped.

A request belongs to a workspace when a held item names it as its space and the request's host
(`hostServerId`) hosts it: this relay for its own workspaces, the bound host for one elsewhere
(`inbox/requestWorkspace.ts`). Anything else, a direct space included, is from outside every
workspace. A workspace's sidebar heads its Conversations with "Requests (n)" for its own
requests, and the direct space's list with "Requests (n)" for those from outside; each opens
the inbox filtered to that scope in the main area. A stranger's DM therefore never sits among a
colleague's.

A request from a fellow member is accepted without asking only when their shared workspace lets
them through: the person's choice for it in `myDmSettings` (else the workspace's default) is
`DIRECT`, or the sender is its Owner or a Moderator by the member list its host answers. A
workspace `myDmSettings` does not list, such as one on another server, counts as `DIRECT`.

### Who can message me

The person's own choices live in Settings → Direct messages (`myDmSettings`,
`setMyDmSettings`, `setMyWorkspaceDmSetting`): Requests or Nobody for people outside their
workspaces, locked with the reason ("Set by your server's operator", "Set by the workspace …")
while `outsideFloorFrom` names a refusing floor, and Direct or Requests per workspace beside the
workspace's default. An Owner sets the workspace's floor and default in Settings → Workspace →
Direct messages (`setWorkspaceDmPolicy`); a Moderator sees them read-only. About shows the
operator's `serverInfo.dmInbound`, `dmOutbound` and `dmPartners`.

While the other member has the viewer's DM as a pending request
(`Conversation.dmRequestPending`, asked on its own so a host without it fails only there), the
conversation says "Sent as a request; … has not accepted yet", and after the two messages the
relay holds beside the invite, that the rest waits; their presence and typing stay hidden.

## Workspaces on other servers

An invite to a workspace elsewhere is a link:
`rim-invite:1:<host server id>:<host key hash>:<invite token>:<host origin>`. It is read like a
device-link code (ASCII whitespace removed, at most 400 characters, scheme case ignored, split at
the first four `:` after the scheme, so the origin keeps its colons). The join dialog takes it
where it takes an invite code; plain codes still join workspaces on this server.

A workspace's public link, `https://<origin>/join/rim_pjl_…`, is another server's when its
origin is neither this app's web origin nor its API origin (`auth/inviteCode.ts`); a bare token
is this server's. Such a link names its host by origin only: `remoteServer(origin)` pins
whatever server id the origin answers.

Joining (`remote/joinRemote.ts`):

1. `remoteServer(origin)` pins the host through the relay; the log must hash to the invite's
   server id, and the key hash must name a key of the log followed only by `signer: server`
   rotations. Anything else is refused before the host is asked anything.
2. `remoteJoinChallenge(hostServerId, hostOrigin, inviteToken, publicLinkToken)` gets the host's
   login challenge and the workspace the token names; for a public link also its name and
   `publicLinkMode`, which **Add workspace** shows (on **Continue**, so a half-typed link is never
   looked up) before the person chooses **Join** or **Ask to join**.
3. The device signs a `login` statement whose `audience` is the host's server id
   (`key_identity_sign_login_for_server`, or the browser's device key) and a delegation for the
   relay (below).
4. `joinRemoteWorkspace` joins. The space is bound to the host, the delegation kept, and the
   host's `streamHeads` of `w` and `u:<principal id>` (asked through the forward path) become
   the baseline of its events; without them the first event seen is the baseline.

Through a public link that takes join requests, `joinRemoteWorkspace` answers `outcome:
REQUESTED`: nothing is bound, kept or subscribed. The request is kept in `localStorage`
(`rim:remote-join-requests:<account>`, `remote/pendingRemoteJoins.ts`) until it is decided or
expires, and **Add workspace** lists it under **Waiting for approval** with its server, without
Withdraw. The decision arrives as a `JoinRequestDecided` relay item on `u:<principal id>` for a
space this account does not use yet; the stream lets it through only while such a request is
kept for that host and workspace, verified like any item, applied once outside the stream's
order, and without binding the space. It is matched by the kept request, never by its
`user_id` (the person's id at the host): `accepted` joins as a current member with a fresh
challenge and delegation and no token, then notifies; `declined` notifies; `cancelled` only
forgets the request.

The workspace then shows in the rail after this server's own, under the name its host answers,
and everything it shows is loaded through the forward path. A person with no workspace here
opens their first one elsewhere.

## Delegations

A delegation lets the relay carry one workspace's traffic between this device and the
workspace's host until it expires:

```json
{"v":2,"type":"delegation","principalId":"rimp1_…","deviceId":"<uuid>","relay":"rims1_…","relayKeyHash":"…",
 "host":"rims1_…","workspaceId":"<uuid>","scope":"workspace","nonce":"<16 bytes>","issuedAt":"…","expiresAt":"…"}
```

It is signed by the device key over `rim.delegation.v1\0 || payload`, runs exactly 24 hours from
a whole second, and names the relay by its server id and the hash of its current key, which the
app reads from the relay's own discovery document (fetched directly and pinned like any server,
`remote/relaySelf.ts`). Both platforms refuse fields a host would refuse (another scope, a nonce
that is not 16 bytes, more than 24 hours, times that are not whole-second UTC).

While the app runs it checks every 10 minutes, at start and whenever its WebSocket comes back:
a workspace whose delegation (kept in IndexedDB `delegations`) has under 6 hours left, names
another relay or is missing gets a new one, sent with `renewDelegations` (64 per call). A
delegation the host refused is not kept. One that had already expired means every device was
away long enough for the subscription to lapse: the space catches up through its change feed,
its lists and its stream heads. Settings > Security > "Spaces through this relay" lists
`remoteSubscriptions` with their status, the subscription's expiry and this device's delegation's,
and renews them all on request.

## Revocation

Removing a device in Settings > Security keeps the signed revocation and follows it to every
host holding the account (IndexedDB `meta`, so a restart does not lose it):

- `deviceRevocationStatus(deviceId)` every 5 seconds, and at once on `RevocationAcked`. Each
  host's acknowledgement is checked against the host's pinned key at its `keySeq`: it must name
  the host, the principal and device of the revocation, and the SHA-256 of the revocation's
  payload. An acknowledgement that does not verify counts as none.
- Two minutes in, the app sends the revocation itself to every host without a verified
  acknowledgement: it fetches the host's discovery document directly, checks it against the pin
  and calls `applyRemoteRevocation` on the host's own `/api` (no session, no CSRF header), then
  checks that acknowledgement the same way.
- A host still without one is named: "<host> has not confirmed; the device keeps access to
  <workspace> until <time>", where the time is the subscription's expiry and never more than 24
  hours after the revocation, since every delegation the removed device signed runs out by then.

## Direct connection

The desktop app talks to a host itself when the relay fails it (`direct/directConnection.ts`):

- **When.** Every 15 seconds the app looks at each host it uses: forwarded requests failing for
  60 seconds (network errors, 5xx, answers that do not verify), the relay's WebSocket down for 60
  seconds, or "Messages may be missing" still shown after reconciling. The first time for a host
  it asks: "Connect directly to <host>? It will see your IP address", and remembers the answer
  (IndexedDB `meta`, per account). "Connect directly" on the notice asks again.
- **How.** It fetches the host's discovery document directly, checks it against the pin (a fork
  stops it), opens a session on the Tauri side at the host's own endpoints, and signs in with
  `keyLoginChallenge` and `loginWithKey`, the proof's `audience` the host's server id. GraphQL for
  the host's spaces goes there instead of `/api/remote/…`, and `workspaceEvents` for each of its
  spaces runs over a `graphql-ws` client whose socket the Tauri side opens with the host's
  session cookie (`direct/directSocket.ts`). A banner says "Connected directly to <host>".
  Meanwhile the relay stream holds that host's items, unapplied and unacknowledged.
- **Back.** Every 60 seconds the app probes `relayInfo`. After two successes in a row it renews
  the delegations through the relay, asks the host directly for the stream heads of every stream
  it knows there, takes them as the baseline, runs the held relay items (those at or below a
  head are dropped, so nothing applied directly is applied again), and closes the session and
  its sockets.

The Tauri side (`src-tauri/src/relay/direct.rs`) keeps one cookie jar per server, adds the
`X-CSRF-Token` header from that server's `rim_csrf` cookie, and lets a session point only at
`/api` and `/api/ws` of an origin whose discovery document it fetched. The webview never sees
those cookies, and its own session stays with its relay.

The web app cannot hold a session with another origin, so it fetches discovery documents and
sends `applyRemoteRevocation` with plain `fetch` and nothing else; its "Connect directly" button
is disabled with the reason beside it.

## Switching relays

Settings > Security > "Switch relays" (desktop: it signs cards with the identity key) moves the
account to another relay in six steps, saved after each (`remote/relaySwitch.ts`):

1. Pin the new relay from its discovery document, open a direct session and sign in there with
   this device's key, or, the first time, `signupWithKey` with the account's key log, this
   device's certificate and a proof for the new relay's server id (and a proof-of-work when the
   new relay is in `pow` registration mode, below).
2. Publish a card listing both relays, the new one first, on both.
3. Sign a delegation for the new relay for every workspace this account uses, those the old
   relay hosts included, and present them with `renewDelegations` there.
4. Drain the old relay's queue through `relayItems` into the stream processor; from step 3 on
   every host delivers to both relays.
5. If the old relay is going away, note the conversations in its direct space.
6. Publish a card with the new relay only, call `leaveRelay` on the old one, copy this device's
   records (spaces, stream positions, contact names) to the new account, link the device key to
   the account there, and point the app at the new relay (`setRelayEndpoint`).

The app then restarts on the new relay; its first key sign-in there uses the linked key. The
carried stream positions make the new relay's copies of events already read duplicates, so
nothing is applied twice and nothing is lost. The noted conversations get successors in the new
relay's direct space, with the old relay's direct space bound as a space elsewhere. A step that
fails shows why and stays where it stopped; "Continue" picks it up, also after a restart, signing
in to the new relay again first.

## Signing up on a public relay

A public relay runs in `pow` registration mode: `registrationMode` answers `POW`, and its
descriptor says `registration: { mode: "pow", powBits }`. It takes a key-only signup with an
invite token, as any server does, or without one when `signupWithKey` carries `proofOfWork`: an
8-byte nonce, unpadded base64url, such that

```
SHA-256("rim.pow.v1\0" || relay server id || "\0" || inception payload || nonce)
```

starts with `powBits` zero bits (rim-server `docs/specs/server-to-server-v1.md`, "Public relay").
The work is bound to that relay and to the new account's inception, so it cannot be reused for
another account or another relay.

- **Where the person signs up.** In `pow` mode the login page links to `/join` wherever the app
  can hold keys (the desktop app, and a browser with WebCrypto Ed25519 and IndexedDB), and that
  page offers the key signup. A browser that cannot hold keys says to use the desktop app or an
  invite. An invite link's page is unchanged, and its token skips the proof.
- **When.** `signupWithKey` (`key-identity/api/keyIdentity.ts`) reads this server's discovery
  document first (fetched from the transport origin and verified against the identity origin,
  "This server's address" above; `pow/proofOfWork.ts` `readRegistration`), and in `pow` mode
  searches over the draft's inception payload (the draft carries it, the same bytes the signed key
  log starts with) before it asks for the login challenge, which expires in two minutes. When the
  document cannot be read, the app asks `registrationMode`: a server that answers `OPEN` or
  `INVITE_ONLY` gets the signup without a proof; otherwise nothing is signed or sent and the form
  says "Could not read how this server takes new accounts, so the account was not created", with
  "Try again".
  The nonce is kept per draft, so a retry after another refusal sends it again; a refusal of the
  proof itself (`VALIDATION` or `FORBIDDEN` naming it) drops it and the next try searches again.
  A relay switch to a relay in `pow` mode does the same with the account's inception.
- **A full server.** A server at its account cap (`RIM_LIMIT_ACCOUNTS`) says
  `registration: { full: true }` in its discovery document, unsigned and advisory, and
  `serverInfo.registrationFull`. `readRegistration` reads `full` from the document as fetched
  (`discoveryRegistrationFull`), and `signupWithKey` then throws `RegistrationClosed` before any
  proof-of-work is searched for or anything is signed; the form says "This server is full". The
  sign-in and signup pages and the desktop's server choice read `serverInfo.registrationFull`
  and say the same before anyone starts, and a signup the server refuses with
  `REGISTRATION_FULL` says it too.
- **The search.** Both platforms find the smallest counter that meets the difficulty, as an 8-byte
  big-endian nonce, so they send the same nonce; `protocol/pow-vectors.json` holds known answers
  both reproduce (the server's own vector among them). The desktop runs it on every core
  (`relay_solve_pow`, cancelled with `relay_cancel_pow`); the web app in a dedicated worker
  (`pow/pow.worker.ts`) with a SHA-256 that hashes everything before the nonce once, terminated to
  cancel. 24 bits is about 16.8 million hashes on average: well under a second in a release build
  of the desktop app, a few seconds in a browser on a fast machine.
- **On screen.** The signup form shows "Proving this is a real device…" with the time so far and
  a Cancel button; past ten seconds it says how much work the relay asks for and how long that
  takes. A refused proof shows the server's words with "Try again".

## What needs two servers

The vector, statement and flow tests run against mocks. These need two rim-servers with S5-2
(one relay each) and two desktops: a DM across relays from contact link to Welcome, messages,
edits and read state; a group with members on both; the request inbox (accept, ignore, block,
read first, auto-accept); a gap and its reconciliation (stop the home's outbox briefly); a host
key rotation and a forged fork; the successor after the home is stopped for 7 days (or with the
clock moved).

With S5-4 on both servers (one the relay, one the host of a workspace):

- joining from a `rim-invite:` link, channel traffic both ways, and the space loading through
  the forward path; an invite whose key hash the host no longer uses;
- delegation renewal (move the clock past 18 hours) and a lapse (keep every device away 24
  hours), then the catch-up;
- revoking a device with the host reachable (acknowledged through the relay), and with the
  relay's fan-out blocked (sent directly at two minutes), and with the host down (named with the
  expiry);
- the direct connection: stop the relay for a minute, accept the notice, read and send in the
  workspace, start the relay again and check nothing shows twice;
- a relay switch between two relays with a workspace on a third server, sending messages
  throughout, then restarting on the new relay.
