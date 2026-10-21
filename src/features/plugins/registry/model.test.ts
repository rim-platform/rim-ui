import { describe, expect, it } from "vitest";

import {
  PluginRuntimeKind,
  WorkspacePluginStatus,
} from "../../../core/graphql/generated/schema-types";
import { HELLO_WEB_MANIFEST } from "../web/testing/helloWeb";
import {
  installState,
  paletteLine,
  planUpdate,
  publisherOf,
  runsHere,
  shortPrincipal,
  sourceLine,
  trustBadge,
} from "./model";
import { registryPaletteItems } from "./palette";
import { ENDPOINT, SERVER, SHA, helloEntry, installedHello, verified } from "./testing/fixtures";
import { PUBLISHER } from "./testing/signedHelloWeb";

const withCommand = (command: string) =>
  HELLO_WEB_MANIFEST.replace('"commands":[', `"commands":[${command},`);
const withCapabilities = (capabilities: string[]) =>
  HELLO_WEB_MANIFEST.replace(
    '"entrypoint"',
    `"capabilities":${JSON.stringify(capabilities)},"entrypoint"`,
  );

describe("the trust badge", () => {
  it("shows the member's name from the workspace when a member has the principal id", () => {
    const members = [
      { principalId: "rimp1_other", username: "bob", displayName: "Bob" },
      { principalId: PUBLISHER, username: "ada", displayName: "Ada Lovelace" },
    ];
    const publisher = publisherOf(PUBLISHER, "Ada", members);
    expect(publisher).toEqual({ principalId: PUBLISHER, name: "Ada Lovelace", member: true });
    expect(trustBadge(publisher)).toBe("Signed by Ada Lovelace · rimp1_txDLbnip");
    expect(paletteLine(WorkspacePluginStatus.RECOMMENDED, "Acme", publisher)).toBe(
      "Recommended by Acme · signed by Ada Lovelace (rimp1_txDLbnip)",
    );
  });

  it("quotes the self-asserted name and calls out a publisher who is not a member", () => {
    const members = [
      { principalId: "rimp1_other", username: "bob", displayName: "Bob" },
      { principalId: null, username: "carol", displayName: null },
    ];
    const publisher = publisherOf(PUBLISHER, "RIM team", members);
    expect(publisher.member).toBe(false);
    expect(trustBadge(publisher)).toBe(
      "Signed by “RIM team” (not a member of this workspace) · rimp1_txDLbnip",
    );
    expect(paletteLine(WorkspacePluginStatus.REQUIRED, "Acme", publisher)).toBe(
      "Required by Acme · signed by “RIM team”, not a member of this workspace (rimp1_txDLbnip)",
    );
  });

  it("falls back to the member's username when they have no display name", () => {
    const publisher = publisherOf(PUBLISHER, "Ada", [{ principalId: PUBLISHER, username: "ada" }]);
    expect(trustBadge(publisher)).toBe("Signed by ada · rimp1_txDLbnip");
  });

  it("shortens principal ids and describes sources", () => {
    expect(shortPrincipal(PUBLISHER)).toBe("rimp1_txDLbnip");
    expect(sourceLine({ kind: "bundle", sha256: SHA, size: 1605 })).toBe(
      "Bundle 5b154b3e… · 1.6 KB",
    );
    expect(
      sourceLine({
        kind: "git",
        url: "https://github.com/acme/k8s-pods.git",
        commit: "1a2b3c4d".repeat(5),
        treeSha256: SHA,
      }),
    ).toBe("git github.com/acme/k8s-pods @ 1a2b3c4d");
  });
});

describe("where this device stands with an entry", () => {
  const check = verified({ hash: "a".repeat(64) });

  it("tells installed, another statement, another workspace and a local copy apart", () => {
    expect(installState(check, [], ENDPOINT, SERVER).kind).toBe("notInstalled");
    expect(installState(check, [installedHello({}, "a".repeat(64))], ENDPOINT, SERVER).kind).toBe(
      "installed",
    );
    const stale = installState(check, [installedHello()], ENDPOINT, SERVER);
    expect(stale).toMatchObject({ kind: "otherStatement", publisherChanged: false });
    const elsewhere = installedHello({
      source: {
        kind: "registry",
        endpoint: ENDPOINT,
        serverId: "other",
        pluginId: "dev.example.hello-web",
        statementSha256: "b".repeat(64),
        publisherPrincipalId: "rimp1_someoneelse",
      },
    });
    expect(installState(check, [elsewhere], ENDPOINT, SERVER)).toMatchObject({
      kind: "otherWorkspace",
      serverId: "other",
      publisherChanged: true,
    });
    const local = installedHello({ source: { kind: "local" } });
    expect(installState(check, [local], ENDPOINT, SERVER).kind).toBe("local");
  });

  it("the web app does not offer desktop-kind entries", () => {
    const desktopEntry = verified({
      entry: helloEntry({ runtimeKind: PluginRuntimeKind.DESKTOP_LOCAL_PROCESS }),
    });
    expect(runsHere(desktopEntry, false)).toBe(false);
    expect(runsHere(desktopEntry, true)).toBe(true);
    const [item] = registryPaletteItems(
      [
        {
          check: desktopEntry,
          publisher: publisherOf(PUBLISHER, "Ada", []),
          state: { kind: "notInstalled" },
          runsHere: false,
        },
      ],
      "Acme",
    );
    expect(item.title).toBe("Install Hello Web");
    expect(item.registry.refusal).toBe("Needs the desktop app");
    expect(item.description).toContain("Needs the desktop app");
  });

  it("lists entries that fail verification with the reason, never as installable", () => {
    const [item] = registryPaletteItems(
      [
        {
          check: {
            ok: false,
            entry: helloEntry(),
            reason: "signature does not verify",
            statementSha256: "c",
          },
          publisher: publisherOf(PUBLISHER, "Ada", []),
          state: { kind: "notInstalled" },
          runsHere: true,
        },
      ],
      "Acme",
    );
    expect(item.registry.refusal).toBe("Signature does not verify: signature does not verify");
  });
});

describe("update rules", () => {
  it("installs at once when nothing new is asked for", () => {
    expect(planUpdate(installedHello(), verified()).automatic).toBe(true);
  });

  it("waits when the publisher changed", () => {
    const plugin = installedHello({
      source: {
        kind: "registry",
        endpoint: ENDPOINT,
        serverId: SERVER,
        pluginId: "dev.example.hello-web",
        statementSha256: "0".repeat(64),
        publisherPrincipalId: "rimp1_someoneelse",
      },
    });
    const plan = planUpdate(plugin, verified());
    expect(plan).toMatchObject({ automatic: false, publisherChanged: true });
  });

  it("waits when the runtime kind changed", () => {
    const plan = planUpdate(installedHello({ runtime_kind: "DesktopLocalProcess" }), verified());
    expect(plan).toMatchObject({ automatic: false, kindChanged: true });
  });

  it("waits for a capability the person was not asked for, not for one they approved", () => {
    const check = verified({ manifest: withCapabilities(["ui.notify"]) });
    expect(planUpdate(installedHello(), check)).toMatchObject({
      automatic: false,
      newCapabilities: ["ui.notify"],
    });
    const approved = installedHello({ approved_capabilities: ["ui.notify"] });
    expect(planUpdate(approved, check).automatic).toBe(true);
  });

  it("waits for an AI-callable command beyond those consented", () => {
    const command =
      '{"id":"summarize","title":"Summarize","description":"d","ai_callable":true,"output_schema":{"type":"object"}}';
    const check = verified({ manifest: withCommand(command) });
    expect(planUpdate(installedHello(), check)).toMatchObject({
      automatic: false,
      newAiCommands: ["summarize"],
    });
    const consented = installedHello({ approved_ai_commands: ["summarize"] });
    expect(planUpdate(consented, check).automatic).toBe(true);
  });

  it("waits when an approved network.fetch would reach other sites", () => {
    const fetching = (origins: string[]) =>
      verified({
        manifest: HELLO_WEB_MANIFEST.replace(
          '"entrypoint"',
          `"capabilities":["network.fetch"],"network_origins":${JSON.stringify(origins)},"entrypoint"`,
        ),
      });
    const plugin = installedHello({
      capabilities: ["network.fetch"],
      approved_capabilities: ["network.fetch"],
      network_origins: ["https://api.github.com"],
    });
    expect(planUpdate(plugin, fetching(["https://evil.example"]))).toMatchObject({
      automatic: false,
      sitesChanged: true,
    });
    expect(planUpdate(plugin, fetching(["https://api.github.com"])).automatic).toBe(true);
    const unapproved = installedHello({ capabilities: ["network.fetch"] });
    expect(planUpdate(unapproved, fetching(["https://evil.example"])).sitesChanged).toBe(false);
  });
});
