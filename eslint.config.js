import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

// Minimal, non-type-aware flat config (see docs/eslint-prettier.md for the
// rationale). `tseslint.configs.recommended` deliberately, not
// `recommendedTypeChecked` — type-aware linting needs `parserOptions.project`
// wiring and `tsconfig.json` excludes test files, which would break typed
// linting on the test suite. Fast today, room to upgrade later.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "coverage/**",
      "node_modules/**",
      "src-tauri/**",
      "src/core/graphql/generated/**",
      "sdk/plugin-sdk/src/generated/**",
      // wasm-bindgen's output (`npm run build:wasm`).
      "src/features/e2ee/wasm/**",
      "*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // `eslint-plugin-react-hooks` v7 bundles the React Compiler-oriented rule
  // set (immutability/purity/gating/etc.) under `recommended`, not just the
  // two legacy hook rules. The `.flat` variant is the actual flat-config
  // shape this version exposes (the plain `.recommended` export is still
  // eslintrc-shaped and would silently no-op under flat config).
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
      "react-hooks/rules-of-hooks": "error",
      // The rest of the React Compiler-readiness rules this plugin version
      // ships under `recommended` (static-components, use-memo, immutability,
      // globals, refs, set-state-in-effect, error-boundaries, purity,
      // set-state-in-render, unsupported-syntax, config, gating,
      // incompatible-library, void-use-memo, preserve-manual-memoization):
      // downgraded to warn. The codebase predates these rules and fixing
      // every violation is out of scope for standing up the lint gate — see
      // docs/eslint-prettier.md for the full list and follow-up plan.
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/void-use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
    },
  },
  eslintConfigPrettier,
);
