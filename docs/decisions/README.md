# Decisions

Sealed, historical design records. ADR-style.

## Convention

- Each file documents a design decision and its implementation outcome.
- Files in this directory are **frozen** once sealed (status header at top says "Do not edit").
- For changes to behavior described here, write a NEW ADR rather than editing the historical one.
- Active design work lives in `docs/`; once landed and reviewed, specs are sealed and moved here.

## Index

- `registration-redesign-frontend-2026-04-28.md` — Frontend implementation of the multi-tenant registration redesign (JoinPage / JoinForm flows, BOOTSTRAP/INSTANCE/WORKSPACE token-type routing, useServerConfig wrapping).
