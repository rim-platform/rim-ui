# Security policy

## Supported versions

RIM is pre-release. Only the `master` branch is supported; fixes land there and are not
backported to older commits or builds.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting on this repository: open the
**Security** tab and choose **Report a vulnerability**. Never open a public issue, pull request or
discussion for a vulnerability.

Include what you can of:

- what the vulnerability is and what an attacker gains from it;
- the affected component (the desktop app, the web app, the plugin host, a plugin protocol or
  SDK detail, the MLS engine, the history archive) and the commit or build you tested;
- the platform: Linux, macOS, Windows or a browser, with versions;
- steps or a proof of concept that reproduce it;
- any logs, with tokens, keys, passwords and personal data removed.

## What happens next

- We acknowledge the report within seven days.
- We send a fix, or a decision with the reasons for it, within ninety days.
- We agree with you when the issue is disclosed, normally once a fix is on `master`.
- We credit you in the advisory if you want, under the name you choose.

## Scope

This policy covers this repository: the desktop and web client, the local plugin host and its
protocol, the web plugin sandbox, the plugin SDK and the example plugins. The server, the relay
and the server-to-server protocol are covered by the `SECURITY.md` in the `rim-server`
repository; report those there. A weakness in a specification both repositories implement can
go to either.

Out of scope: vulnerabilities in third-party plugins (report them to their authors), findings
that need an already compromised device or operating system account, and reports produced by an
automated scanner without a demonstrated impact.
