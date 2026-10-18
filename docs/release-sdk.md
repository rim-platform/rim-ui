# Publishing the plugin SDK

The plugin SDK in `sdk/plugin-sdk` is published to npm as `@rim-platform/plugin-sdk`. It keeps a
version of its own, in `sdk/plugin-sdk/package.json`, and is released apart from the app: a tag
`plugin-sdk-v<version>` publishes the SDK, and an app tag `v<version>` publishes no SDK.

## What a release does

The tag `plugin-sdk-v<version>` starts `.github/workflows/sdk-release.yaml`. Its one job runs in
the `npm` environment and waits for the maintainer's approval. It:

1. fails when the tag does not name the version in `sdk/plugin-sdk/package.json`, when that
   version is not `<major>.<minor>.<patch>[-<pre-release>]`, or when the tagged commit is not on
   `master`;
2. publishes nothing, with a notice, when npm already has that version;
3. otherwise builds the SDK, runs `npm run sdk:smoke` (the tarball installed into a copy of the
   template plugin outside the repository), and runs `npm publish --provenance --access public`
   from `sdk/plugin-sdk`. A pre-release version goes out under the dist-tag `next`, so
   `npm install` keeps the last release.

The job holds no npm token: npm trusts this workflow as the package's publisher (trusted
publishing, over the job's OIDC token) and records a provenance statement that names the run. A
failed publish is retried with "Re-run failed jobs" on the run's page.

## Releasing a new SDK version

1. In a pull request, set the version:

   ```sh
   npm version <version> --workspace sdk/plugin-sdk --no-git-tag-version
   ```

   This writes `sdk/plugin-sdk/package.json` and the workspace's entry in `package-lock.json`.
   The SDK follows semantic versioning on its own: a change a plugin has to adapt to is a new
   major version (a new minor one while it is `0.x`).
2. Add the `CHANGELOG.md` lines naming the changed functions or types.
3. Once the pull request is merged, tag the merge on `master` and push the tag:

   ```sh
   git switch master && git pull
   v=$(jq -r .version sdk/plugin-sdk/package.json)
   git tag -a "plugin-sdk-v$v" -m "@rim-platform/plugin-sdk $v"
   git push origin "plugin-sdk-v$v"
   ```

4. Approve the run in the `npm` environment. When it is green,
   `npm view @rim-platform/plugin-sdk@<version>` shows the version.

## Setting up publishing

npm lets a workflow publish a package only once the package exists, so the first version was
published by hand. These steps, done once, hand publishing to the workflow:

1. The npm organization `rim-platform`, created from an account with two-factor
   authentication, owns the `@rim-platform` scope.
2. The first version, from a clean checkout of the commit to publish, with `npm login` done:

   ```sh
   npm ci
   npm run sdk:smoke
   cd sdk/plugin-sdk
   npm publish --access public --provenance=false
   ```

   `--provenance=false` because a provenance statement can only be made in a CI job; the package
   asks for one by default (`publishConfig.provenance`). `npm publish` builds `dist/` itself
   before packing.
3. On npmjs.com, open the package's Settings, Trusted Publisher, and set GitHub Actions with:

   | Field             | Value              |
   | ----------------- | ------------------ |
   | Organization      | `rim-platform`     |
   | Repository        | `rim-ui`           |
   | Workflow filename | `sdk-release.yaml` |
   | Environment       | `npm`              |

4. In the same Settings, set Publishing access to require two-factor authentication and
   disallow tokens. The workflow still publishes; a leaked token cannot.
5. On GitHub, the `npm` environment and the ruleset on `plugin-sdk-v*` tags that
   `CONTRIBUTING.md` lists under Repository settings.

A run whose workflow file or environment npm does not trust fails at `npm publish` with a 404
or an authentication error and publishes nothing; fix the Trusted Publisher entry and re-run.
