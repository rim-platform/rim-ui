<!--
Describe the change in your own words. Contributions are accepted under the Apache License 2.0
(CONTRIBUTING.md). A security fix is coordinated privately first (SECURITY.md).
-->

## What changes, and for whom

<!-- The behaviour a user, a plugin author or an operator sees after this merges. -->

## What it does not do

<!-- Cases left out on purpose, so a reviewer does not look for them. -->

## How it was tested

<!--
The commands you ran and the tail of their output. If a gate could not run, say which and why.
-->

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run sdk:typecheck` (the plugin SDK, the protocol schema or `plugins/` changed)
- [ ] `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` and
      `cargo test` in `src-tauri/` (the Rust side changed)
- [ ] `npm run build:wasm` with the rebuilt module committed (the MLS crates changed)

## Docs and schema

<!--
The page in docs/ or the spec this changes, updated in the same pull request. If the GraphQL
schema changed, schema.graphql is exported from the server and `npm run codegen` was run.
-->
