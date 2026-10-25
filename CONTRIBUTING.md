# Contributing

Anyone can contribute. Open a pull request against `master` and the maintainers will review it.

This repository is licensed under the Apache License 2.0 (see `LICENSE`), and contributions are
accepted under the same license.

Everyone taking part follows the code of conduct in `CODE_OF_CONDUCT.md`. A security
vulnerability is never reported in a public issue or pull request: `SECURITY.md` says how to
report it privately.

## Who can merge and publish

- **Every change is a pull request.** Nobody pushes to `master` directly, the maintainer
  included.
- **CI must pass.** The jobs of `.github/workflows/ci.yaml` are required checks; a pull request
  whose checks fail or did not run cannot merge.
- **The maintainer merges.** `.github/CODEOWNERS` names the maintainer, @dvorakj31, as the
  reviewer of every path, and only the maintainer has write access. Everyone else works from a
  fork.
- **The maintainer releases.** Only the maintainer can push a `v*` tag. The tag starts
  `.github/workflows/release.yaml`, which publishes nothing until the maintainer approves the
  run in the `release` environment. The plugin SDK is released apart from the app: the
  maintainer's tag `plugin-sdk-v<version>` starts `.github/workflows/sdk-release.yaml`, which
  waits for an approval in the `npm` environment (`docs/release-sdk.md`).
- **Images are signed.** `ghcr.io/rim-platform/rim-web` is signed with cosign keyless by the
  release workflow. The certificate names the workflow and the tag, so an image built or signed
  anywhere else does not verify:

  ```sh
  v=<version>
  cosign verify ghcr.io/rim-platform/rim-web:$v \
    --certificate-identity https://github.com/rim-platform/rim-ui/.github/workflows/release.yaml@refs/tags/v$v \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

  Each release also carries the image's SBOM (SPDX JSON), attested to the image's digest as a
  GitHub attestation: `gh attestation verify oci://ghcr.io/rim-platform/rim-web@<digest> --repo
  rim-platform/rim-ui --predicate-type https://spdx.dev/Document/v2.3` checks it.

### Repository settings

The rules above live in the repository's settings on GitHub, which the maintainer keeps:

1. **Ruleset on `master`.** Require a pull request before merging, with one approval and review
   from Code Owners. Require the status checks `Code Quality`, `Rust (src-tauri)`,
   `Cargo Audit (src-tauri)`, `Build` and `Docker Build`. Block force pushes and deletion.
   Bypass list: the maintainer, for pull requests only, so the maintainer's own pull requests
   merge without a second reviewer.
2. **Ruleset on tags `v*` and `plugin-sdk-v*`.** Restrict creations, updates and deletions.
   Bypass list: the maintainer only.
3. **Environment `release`.** Required reviewer: the maintainer, with "Prevent self-review" off
   (the maintainer pushes the tag and approves the run). Deployment branches and tags: the tag
   pattern `v*` only. Administrators may not bypass the protection rules.
   **Environment `npm`**, for the SDK: the same, with the tag pattern `plugin-sdk-v*` only. It
   holds no secrets; npm trusts the workflow over OIDC.
4. **Actions.** Workflow permissions: read repository contents and packages. Actions may not
   create or approve pull requests. Workflows from forks need approval for all external
   contributors. Allowed actions: GitHub's own and those the workflows name (`docker/*`,
   `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `taiki-e/install-action`,
   `anchore/sbom-action`, `sigstore/cosign-installer`). Requiring actions pinned to a full
   commit SHA can follow once `ci.yaml` pins its actions as `release.yaml` does.
5. **Access.** Nobody but the maintainer holds the write role or above.
6. **Package `rim-web`.** After the first release: visibility public, and under "Manage Actions
   access" only this repository, with the write role.
