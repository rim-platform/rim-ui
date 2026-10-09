# ESLint + Prettier

The frontend has a lint/format gate: `npm run lint`, `npm run lint:fix`, `npm run format`,
`npm run format:check`. `npm run build` (TypeScript check + Vite build) and `npm test`
remain the other two gates. All four should pass before shipping a frontend change.

## Running it

```bash
npm run lint          # eslint . — 0 errors required, warnings are OK for now
npm run lint:fix       # eslint . --fix — apply auto-fixes
npm run format         # prettier --write . — reformat everything
npm run format:check   # prettier --check . — CI-safe, no writes
```

## Flat-config rationale

`eslint.config.js` is ESM (the package is `"type": "module"`), composed in this order:

1. `js.configs.recommended` — core ESLint correctness rules.
2. `tseslint.configs.recommended` (typescript-eslint v8) — **not**
   `recommendedTypeChecked`. Type-aware linting needs `parserOptions.project`
   wiring, and `tsconfig.json` excludes test files (`tsconfig.json` → `exclude`),
   which would break typed linting on the test suite. This config is fast and needs
   no project wiring — pragmatic for standing up the gate today. See "Future
   upgrade" below.
3. `eslint-plugin-react-hooks`'s flat `recommended` config.
4. `eslint-plugin-react-refresh`'s `vite` preset (Vite HMR hygiene, warn-level).
5. `eslint-config-prettier` — **last**, disables every stylistic rule that would
   fight Prettier.
6. Global `ignores`: `dist/`, `coverage/`, `node_modules/`, `src-tauri/`,
   `src/core/graphql/generated/`, `sdk/plugin-sdk/src/generated/` and `*.config.js`.

`.prettierrc.json` matches the codebase's existing conventions (verified against the
code, not assumed): double quotes, semicolons, trailing commas, 100-column width.

## The warn-vs-error split, and why

Goal: a green gate today, with room to tighten later — not `eslint-disable` sprinkled
everywhere to force a pass.

**Kept at `error`** (correctness, low false-positive rate):

- `react-hooks/rules-of-hooks` — a real violation is always a bug.
- The rest of `js.configs.recommended` / `tseslint.configs.recommended` that weren't
  explicitly downgraded below (e.g. `no-control-regex`, `no-useless-assignment`,
  `preserve-caught-error`, `no-constant-binary-expression`, `no-useless-escape`) — the
  9 violations these produced on first run were all real, easy fixes (hand-fixed rather
  than downgraded, since there were only a handful).

**Downgraded to `warn`** (noisy, or would need broad manual edits to reach zero):

- `@typescript-eslint/no-unused-vars` — `{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" }`,
  matching the existing `_pluginId`-style convention.
- `@typescript-eslint/no-explicit-any`.
- `react-hooks/exhaustive-deps`.
- `react-refresh/only-export-components`.
- **The `react-hooks` v7 "React Compiler readiness" rule set** — `static-components`,
  `use-memo`, `void-use-memo`, `preserve-manual-memoization`, `incompatible-library`,
  `immutability`, `globals`, `refs`, `set-state-in-effect`, `error-boundaries`,
  `purity`, `set-state-in-render`, `unsupported-syntax`, `config`, `gating`. **This is
  a deviation from the original spec**, which anticipated `eslint-plugin-react-hooks`
  shipping just the two legacy rules (`rules-of-hooks`, `exhaustive-deps`). The
  installed version (7.1.1) bundles the full React Compiler static-analysis rule set
  under `recommended`, most of it at `error`. The codebase predates these rules and
  fixing every violation (dozens, across effect/ref/memoization patterns) is out of
  scope for standing up the lint gate — downgraded to `warn` so the gate is green
  today. Flagged to Vision as a deviation; worth a dedicated pass later if the team
  wants React Compiler compatibility.

Two intentional control-character regexes (`turnBudget.ts`, `generator.ts` — used to
strip control chars from user-facing strings) keep `no-control-regex` at `error` and
carry a scoped `eslint-disable-next-line` with justification, since disabling the rule
project-wide would remove a real correctness check for accidental control chars
elsewhere.

## No type-aware linting yet

`tseslint.configs.recommendedTypeChecked` would catch more (e.g. unsafe `any` flows,
floating promises) but requires `parserOptions.project` pointing at a `tsconfig.json`
that includes the files being linted — including tests, which the current
`tsconfig.json` excludes. To upgrade:

1. Either widen `tsconfig.json`'s `include`/remove the test exclusions, or add a
   second tsconfig (e.g. `tsconfig.eslint.json`) that includes tests, referenced only
   from `eslint.config.js`.
2. Swap `tseslint.configs.recommended` for `tseslint.configs.recommendedTypeChecked`
   and add `languageOptions.parserOptions.project`.
3. Expect a new round of violations; triage warn-vs-error again per the same
   "green gate first" principle.

## CI

Lint and format are not yet wired into CI — only `npm run build` runs today. Frontend
CI should run, in order: `npm ci` → `npm run lint` → `npm run format:check` →
`npm run build` → `npm test`. This is a CI-workflow change, out of scope for this
change (owned separately).
