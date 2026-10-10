# Version skew between client and server

A desktop client lives longer than the server it talks to: users update the app when they
choose, and an operator updates the server when they choose. A client release that sends a
field or a mutation an older server does not have gets the whole operation refused, not just
that field.

`npm run skew:check` shows which operations those are.

```sh
npm run skew:check -- <git ref>   # e.g. v0.3.0, origin/release, HEAD~30
npm run skew:check                # the most recent v* tag
```

It takes `schema.graphql` as committed at the ref (the SDL exported from the server that the
client was built against then), collects every `gql` document under `src/` with its fragments
resolved the way the client sends it, validates each against that schema with `graphql`'s
`validate`, and prints the operations that fail, grouped by file. It exits 1 when any would be
refused, 0 when none would, and 2 when it cannot run (no such ref, no `schema.graphql` there).
With no argument and no `v*` tag yet, it says how to pass a ref and exits 0.

Test files, test helpers and fixtures are not checked; neither is the health check's
introspection query, which every server answers.

## When to run it

- **Before tagging a client release**, against the oldest server release the new client should
  still work with. Every operation it lists is a feature that breaks for users on that server:
  either gate it behind a capability the server reports, or state that the release needs a
  newer server.
- **When a change adds a field to an existing query.** A new field in a query that already
  worked turns the whole query into a refusal on an older server, which is easy to miss in
  review. Running against the last release tag shows it.
- **After `npm run codegen` picks up a new schema**, to see what the client would now ask an
  older server for.

A failure against the current `HEAD` means the client sends something the committed schema does
not have at all: a bug today, not skew.
