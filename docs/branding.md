# Branding

The brand masters live in `rim-server`'s `assets/branding/`, with a README that says what each
file is for. They are the source of truth; this repository holds copies or renderings of them.

| Where | What | From |
|---|---|---|
| `public/rim-favicon.svg`, `public/favicon.ico` | The browser tab icon, linked from `index.html` | `rim-favicon.svg`, `favicon.ico`, copied as they are |
| `src/shared/brand/RimLogo.tsx` | `RimMark`, `RimLockup` and `RimSplash`, inline SVG components | The path data of `rim-mark.svg`, `rim-lockup.svg` and `rim-splash.svg` |
| `src-tauri/icons/` | The desktop app icons listed in `tauri.conf.json`'s `bundle.icon` | `rim-app-icon-1024.png` through `tauri icon` |

The components draw with `currentColor`, so the mark and the wordmark take the text colour of
the element around them, and the splash's knocked-out letters take `rim-void`. Its accent circle
is the `rim-signal` colour token, which nothing else uses. The splash is for loading screens
only, never as the logo, and holds still under `prefers-reduced-motion`.

## Updating from the masters

- Favicon: copy `rim-favicon.svg` and `favicon.ico` into `public/` over the old files.
- Mark, wordmark or splash: copy the changed `d` attributes into the path constants of
  `RimLogo.tsx`, and the splash's per-letter `translate` values into `RimSplash`.
- Desktop icons: from the root of this repository, with `rim-server` checked out next to it,

  ```sh
  npx tauri icon ../rim-server/assets/branding/rim-app-icon-1024.png
  rm -r src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png
  ```

  The removed outputs (the mobile sets and a 64 px size) are not bundled; `bundle.icon` lists
  the rest.

The window title and the bundle names come from `productName` (`RIM`) in `tauri.conf.json`. The
`identifier` `com.rim.rim-ui` stays as it is: the secret vault's credential store entry and the
app data directory are derived from it, and changing it would orphan existing installs.
