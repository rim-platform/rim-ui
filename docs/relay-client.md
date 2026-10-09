# DMs across relays: the client

The app talks only to its own server, its **relay**. A DM or group homed on another relay (its
creator's), and later a workspace hosted elsewhere, is reached through the relay: requests are
signed by this device and forwarded unchanged, answers and pushed events are signed by the host
and checked here against the host's key, pinned on first use. The contract is rim-server
`docs/specs/server-to-server-v1.md`; this document says how the desktop and the web app
implement their side of it.

Everything here switches on when the server answers `relayInfo`. A server without it, or an
account without a principal id (no key sign-in yet), runs exactly as before.

## What lives where

| Where | What |
|---|---|
| `src/features/relay/api/documents.ts` | Every GraphQL document of the relay (`relayInfo`, `remoteServer`, `remoteIdentity`, contacts, `dmRequests` and its mutations, `relayItems`, `ackRelayItems`, `streamHeads`, the `relayStream` subscription, a conversation's predecessor) |
| `src/features/relay/crypto/serverStatements.ts` | The statements in the browser: server key log replay, descriptor, discovery document, device request, host response, host event |
| `src/features/relay/crypto/relayCrypto.ts` | The same work per platform: the Tauri `relay_*` commands and `key_identity_sign_device_request` on the desktop, WebCrypto and the browser's device key in the web app |
| `src-tauri/src/relay/` | The desktop's checks of server statements (`server.rs`) and their commands |
| `src-tauri/src/key_identity/statement.rs` | `device_request`: the payload in the spec's field order, signed by the device key; `verified_card` |
| `src/features/relay/state/` | `relayDb.ts` (IndexedDB `rim-relay`), `serverPins.ts`, `spaces.ts` (which space lives on which host), `useRelayStore.ts` |
| `src/features/relay/transport/` | `remoteFetch.ts` (signed requests, verified answers), `requestSeq.ts`, `relayHealth.ts` |
| `src/features/relay/stream/` | `relayStream.ts` (the queue on the WebSocket), `sequencer.ts`, `streamRules.ts` |
| `src/features/relay/contacts/` | Contact links, fingerprints, verified identities, aliases, relays seen in invites |
| `src/features/relay/inbox/autoAccept.ts`, `components/DmRequestInbox.tsx` | Message requests |
| `src/features/relay/conversations/` | New DMs and groups in the direct space, successors |
| `src/features/relay/runtime/relayRuntime.ts` | Start-up and wiring (`useRelayRuntime`, mounted in `AppShell`) |
| `src/core/graphql/client.ts` | `setSpaceRouter`: the GraphQL client's `fetch` sends a request about a space elsewhere to its host |
| `protocol/relay-vectors.json` | Known answers both platforms reproduce |

## Server pins

A server is pinned the first time the app needs it: the home of a DM someone else started (from
the relays of the inviter's card), a contact's relay. `remoteServer(origin)` fetches the
discovery document through the relay; the app replays the log, checks that its inception hashes
to the expected server id, verifies the descriptor under the head key and that its server-to-server
endpoint is at that origin, and stores the log (`servers`).

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
   missing from <space>" with a retry and "Connect directly", disabled until the direct
   connection lands;
5. applies it through the same handler as `workspaceEvents` (`applyWorkspaceEvent`);
6. acknowledges (`ackRelayItems`) every item up to the first still held, and stores that cursor.

`DmRequestReceived` refreshes the request inbox; `QueueOverflow` reconciles the spaces it names.
`workspaceEvents` is not opened for a space elsewhere.

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

New DMs and groups start in this relay's direct space whenever every member has a principal id:
from the contact picker there, or from a workspace's member picker when everyone picked has one.
`createConversation` names them in `remoteMembers` with the relays of their verified card. With
anyone on another relay the conversation is created end-to-end encrypted, which needs every
member and this device to be set up for encryption; otherwise nothing is created and the picker
says who is not ready. With members of this relay alone, today's rule holds. MLS runs unchanged:
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
verifies the held `DmInvite`, binds the space, processes the Welcome and opens the conversation;
Accept, Ignore, Block (which also leaves the conversation through its home) and Report act on the
relay. A request from someone who is a member of a workspace this person is in (by the member
lists the workspaces' hosts answer) is accepted without asking.

## What needs two servers

The vector, statement and flow tests run against mocks. These need two rim-servers with S5-2
(one relay each) and two desktops: a DM across relays from contact link to Welcome, messages,
edits and read state; a group with members on both; the request inbox (accept, ignore, block,
read first, auto-accept); a gap and its reconciliation (stop the home's outbox briefly); a host
key rotation and a forged fork; the successor after the home is stopped for 7 days (or with the
clock moved).
