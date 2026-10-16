# Publishing the plugin SDK

The plugin SDK in `sdk/plugin-sdk` is published to npm as `@rim-platform/plugin-sdk`. It keeps a
version of its own, in `sdk/plugin-sdk/package.json`, apart from the app's.

## What a release does

The `sdk-publish` job of `.github/workflows/release.yaml` runs on every `v*` tag, after the
GitHub release is published, so a failed publish never holds the release back. It:

1. reads the name and version from `sdk/plugin-sdk/package.json` and fails when the version is
   not `<major>.<minor>.<patch>[-<pre-release>]`;
2. publishes nothing, with a notice, when npm already has that version;
3. otherwise builds the SDK, runs `npm run sdk:smoke` (the tarball installed into a copy of the
   template plugin outside the repository), and runs `npm stage publish --provenance --access
   public` from `sdk/plugin-sdk`: the version is uploaded as a staged version, not published.
   A pre-release version is staged under the dist-tag `next`, so `npm install` keeps the last
   release.
4. The maintainer approves the staged version on npmjs.com (the package page lists it under
   staged versions) with a second factor. Only then does it become installable. npm refuses the
   approval while its malware scan of the upload is still running.

The job runs in the `release` environment and asks for an approval of its own. It holds no npm
token: npm trusts this workflow as the package's publisher (trusted publishing, over the job's
OIDC token), lets it stage but not publish directly, and records a provenance statement that
names the run. A failed job is retried with "Re-run failed jobs" on the run's page.

## Releasing a new SDK version

1. In a pull request before the tag, set the version:

   ```sh
   npm version <version> --workspace sdk/plugin-sdk --no-git-tag-version
   ```

   This writes `sdk/plugin-sdk/package.json` and the workspace's entry in `package-lock.json`.
   The SDK follows semantic versioning on its own: a change a plugin has to adapt to is a new
   major version (a new minor one while it is `0.x`).
2. Add the `CHANGELOG.md` lines naming the changed functions or types.
3. The next `v*` tag stages it; approve it on npmjs.com. A tag that leaves the SDK version as
   it was stages nothing.

## The first publish, by hand

npm lets a workflow publish a package only once the package exists, so the maintainer publishes
the first version from their own computer, then hands publishing to the workflow:

1. Create the npm organization `rim-platform` (npmjs.com, Add Organization) from an account with
   two-factor authentication. It owns the `@rim-platform` scope.
2. From a clean checkout of the commit to publish, with `npm login` done:

   ```sh
   npm ci
   npm run sdk:smoke
   cd sdk/plugin-sdk
   npm publish --access public --provenance=false
   ```

   `--provenance=false` because a provenance statement can only be made in a CI job; the package
   asks for one by default (`publishConfig.provenance`). `npm publish` builds `dist/` itself
   before packing.
3. On npmjs.com, open the package's Settings, Trusted Publisher, and add GitHub Actions with:

   | Field             | Value          |
   | ----------------- | -------------- |
   | Organization      | `rim-platform` |
   | Repository        | `rim-ui`       |
   | Workflow filename | `release.yaml` |
   | Environment       | `release`      |

   Leave "publish directly" unchecked: the workflow stages, the maintainer approves.

4. In the same Settings, set Publishing access to require two-factor authentication and
   disallow tokens. The workflow still publishes; a leaked token cannot.

A tag pushed before the first publish fails the `sdk-publish` job, since npm has no package to
trust the workflow for, and leaves the GitHub release as it is. Re-run the job after step 3: it
finds the version published by hand on npm and stages nothing. The first version the workflow
stages is the next SDK version.
