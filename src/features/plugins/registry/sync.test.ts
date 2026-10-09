import { describe, expect, it, vi } from "vitest";

import { POST_INSTALL_CONSENT_REQUIRED } from "../types";
import { syncRegistryInstalls, type SyncActions, type SyncContext } from "./sync";
import { ENDPOINT, SERVER, installedHello, verified } from "./testing/fixtures";

const NEW_HASH = "a".repeat(64);

function actions(overrides: Partial<SyncActions> = {}): SyncActions {
  return {
    install: vi.fn().mockResolvedValue({ plugin_id: "dev.example.hello-web" }),
    stop: vi.fn().mockResolvedValue(undefined),
    updated: vi.fn(),
    updateFailed: vi.fn(),
    promptUpdate: vi.fn(),
    promptRemoval: vi.fn(),
    ...overrides,
  };
}

function context(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    checks: [verified({ hash: NEW_HASH })],
    installed: [installedHello()],
    endpoint: ENDPOINT,
    serverId: SERVER,
    workspaceName: "Acme",
    ...overrides,
  };
}

describe("keeping registry installs in line with the registry", () => {
  it("installs an update that asks for nothing new at once, keeping approvals", async () => {
    const act = actions();
    expect(await syncRegistryInstalls(context(), new Set(), act)).toBe(true);
    expect(act.install).toHaveBeenCalledWith(
      expect.objectContaining({ statementSha256: NEW_HASH }),
      {
        replace: true,
        keepApprovals: true,
      },
    );
    expect(act.updated).toHaveBeenCalledWith(expect.anything(), "0.1.0");
    expect(act.promptUpdate).not.toHaveBeenCalled();
  });

  it("puts any other update behind a prompt and installs nothing", async () => {
    const act = actions();
    const moved = installedHello({ runtime_kind: "DesktopLocalProcess" });
    await syncRegistryInstalls(context({ installed: [moved] }), new Set(), act);
    expect(act.install).not.toHaveBeenCalled();
    expect(act.promptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceName: "Acme",
        plan: expect.objectContaining({ kindChanged: true }),
      }),
    );
  });

  it("prompts when the update turns out to need post-install steps", async () => {
    const consent = {
      kind: "backend_error",
      code: POST_INSTALL_CONSENT_REQUIRED,
      message: "consent",
      data: {
        plugin_id: "dev.example.hello-web",
        steps: [
          {
            program: "npm",
            args: ["install"],
            working_dir: "/p",
            trigger_file: "package.json",
            command_line: "npm install",
          },
        ],
      },
    };
    const act = actions({ install: vi.fn().mockRejectedValue(consent) });
    await syncRegistryInstalls(context(), new Set(), act);
    expect(act.promptUpdate).toHaveBeenCalled();
    expect(act.updated).not.toHaveBeenCalled();
  });

  it("keeps the old copy when an update fails", async () => {
    const act = actions({ install: vi.fn().mockRejectedValue(new Error("hash mismatch")) });
    expect(await syncRegistryInstalls(context(), new Set(), act)).toBe(false);
    expect(act.updateFailed).toHaveBeenCalledWith(expect.anything(), "hash mismatch");
  });

  it("leaves an install alone when its new statement does not verify or was withdrawn", async () => {
    const act = actions();
    const failed = {
      ok: false as const,
      entry: verified().entry,
      reason: "bad",
      statementSha256: NEW_HASH,
    };
    const withdrawn = {
      ...verified({ hash: NEW_HASH }),
      validity: { status: "publisherRecovered" as const, atSeq: 2 },
    };
    await syncRegistryInstalls(context({ checks: [failed] }), new Set(), act);
    await syncRegistryInstalls(context({ checks: [withdrawn] }), new Set(), act);
    expect(act.install).not.toHaveBeenCalled();
    expect(act.promptUpdate).not.toHaveBeenCalled();
  });

  it("does nothing for an install already at the entry's statement, or from elsewhere", async () => {
    const act = actions();
    await syncRegistryInstalls(
      context({ installed: [installedHello({}, NEW_HASH)] }),
      new Set(),
      act,
    );
    await syncRegistryInstalls(
      context({ installed: [installedHello({ source: { kind: "local" } })] }),
      new Set(),
      act,
    );
    expect(act.install).not.toHaveBeenCalled();
    expect(act.stop).not.toHaveBeenCalled();
  });

  it("stops a plugin whose entry was removed, then asks, once", async () => {
    const order: string[] = [];
    const act = actions({
      stop: vi.fn(async () => {
        order.push("stop");
      }),
      promptRemoval: vi.fn(() => order.push("ask")),
    });
    const handled = new Set<string>();
    await syncRegistryInstalls(context({ checks: [] }), handled, act);
    await syncRegistryInstalls(context({ checks: [] }), handled, act);
    expect(order).toEqual(["stop", "ask"]);
    expect(act.promptRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceName: "Acme" }),
    );
  });

  it("acts on each new statement once", async () => {
    const act = actions({ install: vi.fn().mockRejectedValue(new Error("offline")) });
    const handled = new Set<string>();
    await syncRegistryInstalls(context(), handled, act);
    await syncRegistryInstalls(context(), handled, act);
    expect(act.install).toHaveBeenCalledTimes(1);
  });
});
