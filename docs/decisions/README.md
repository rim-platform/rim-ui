# Decisions

Sealed, historical design records. ADR-style.

## Convention

- Each file documents a design decision and its implementation outcome.
- Files in this directory are **frozen** once sealed (status header at top says "Do not edit").
- For changes to behavior described here, write a NEW ADR rather than editing the historical one.
- Active design work lives in `docs/`; once landed and reviewed, specs are sealed and moved here.

## Index

- `registration-redesign-frontend-2026-04-28.md`: Frontend implementation of the multi-tenant
  registration redesign (JoinPage / JoinForm flows, BOOTSTRAP/INSTANCE/WORKSPACE token-type
  routing, useServerConfig wrapping). Its `BOOTSTRAP` token type no longer exists: the server
  folded bootstrap tokens into instance invites, so an operator's link
  (`rim_server invite create [--email …]`) previews as `INSTANCE` and signs up through
  `instanceInviteToken`. An invite bound to an email address admits only a password signup with
  that address.
- `plugin-runtime-wiring-2026-04-29.md`: wiring the plugin runtime into the app, plugins
  desktop-only in v1, and the trust-on-first-use bundle fingerprint.
- `agent-settings-consolidation-2026-04-30.md`: one AI agent settings panel, with provider keys in
  the OS keyring instead of Stronghold.
- `command-result-surface-2026-05-01.md`: a draft design for showing single-command results in
  the palette.
