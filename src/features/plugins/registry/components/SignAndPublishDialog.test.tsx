import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  ServerFeatureState,
  WorkspacePluginStatus,
} from "../../../../core/graphql/generated/schema-types";
import { serverInfoQueryClient, type FakeFeatures } from "../../../../test/serverInfo";
import type { MyKeyIdentity } from "../../../key-identity/api/keyIdentity";
import { encodeBase64, sha256Hex } from "../../web/bundle";
import { readSignatureFile } from "../signatureFile";
import type { SigningSource } from "../signing";
import { installedHello, SERVER, SHA } from "../testing/fixtures";
import { helloWebBundle, INCEPTION, PUBLISHER, SIGNED_HELLO_WEB } from "../testing/signedHelloWeb";
import { HELLO_WEB_MANIFEST } from "../../web/testing/helloWeb";

const role = vi.hoisted(() => ({ moderator: true }));

vi.mock("../signing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../signing")>()),
  signingSourceOf: vi.fn(),
  pickSigningBundle: vi.fn(),
  exportSignature: vi.fn(async () => "/tmp/dev.example.hello-web-0.1.0.rimsig.json"),
}));
vi.mock("../../../key-identity/api/keyBackend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../key-identity/api/keyBackend")>()),
  signPluginManifest: vi.fn(),
}));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  useWorkspacePlugins: () => ({ data: [] }),
  uploadPluginBundle: vi.fn(async () => ({ sha256: SHA, size: 1605, url: "/x" })),
  addWorkspacePlugin: vi.fn(async () => ({})),
  updateWorkspacePlugin: vi.fn(),
}));
vi.mock("../../../workspaces/api/useMyServerRole", () => ({
  useCanModerate: () => role.moderator,
}));
vi.mock("../../../workspaces/api/useWorkspace", () => ({
  useWorkspace: () => ({ data: { id: SERVER, name: "Acme" } }),
}));
vi.mock("../../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { displayName: "Ada", username: "ada" } }),
}));

import { signPluginManifest } from "../../../key-identity/api/keyBackend";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { addWorkspacePlugin, uploadPluginBundle } from "../api";
import { exportSignature, signingSourceOf } from "../signing";
import { SignAndPublishDialog } from "./SignAndPublishDialog";

const identity: MyKeyIdentity = {
  principalId: PUBLISHER,
  keySeq: 0,
  keyLog: [{ seq: 0, statement: INCEPTION }],
  devices: [],
  profileCard: null,
};

/** Appendix A's bundle, as the host builds it from the installed folder. */
function builtSource(): SigningSource {
  return {
    pluginId: "dev.example.hello-web",
    version: "0.1.0",
    displayName: "Hello Web",
    runtimeKind: "WebSandboxed",
    manifest: HELLO_WEB_MANIFEST,
    source: { kind: "bundle", sha256: SHA, size: 1605 },
    bundle: encodeBase64(helloWebBundle()),
    bundlePath: null,
  };
}

async function signIt(features?: FakeFeatures) {
  const qc = features ? serverInfoQueryClient(features) : new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <SignAndPublishDialog plugin={installedHello()} identity={identity} onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(SHA)).toBeInTheDocument();
  expect(screen.getByLabelText("Publisher name")).toHaveValue("Ada");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
  });
  expect(await screen.findByText(/Signed with your identity key and verified/)).toBeInTheDocument();
}

describe("Sign and publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    role.moderator = true;
    useWorkspaceStore.setState({ workspaceId: SERVER });
    vi.mocked(signingSourceOf).mockResolvedValue(builtSource());
    vi.mocked(signPluginManifest).mockResolvedValue(SIGNED_HELLO_WEB);
  });

  it("signs what the bundler hashes and verifies it before publishing", async () => {
    // The host's bundle of the installed folder hashes like `rim-plugin-bundle`'s.
    expect(await sha256Hex(helloWebBundle())).toBe(SHA);
    await signIt();
    expect(signPluginManifest).toHaveBeenCalledWith(PUBLISHER, [INCEPTION], {
      publisherName: "Ada",
      manifest: HELLO_WEB_MANIFEST,
      source: { kind: "bundle", sha256: SHA, size: 1605 },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    const [, uploaded] = vi.mocked(uploadPluginBundle).mock.calls[0];
    expect(await sha256Hex(uploaded)).toBe(SHA);
    expect(addWorkspacePlugin).toHaveBeenCalledWith({
      serverId: SERVER,
      statement: SIGNED_HELLO_WEB,
      status: WorkspacePluginStatus.RECOMMENDED,
      publisherKeyLog: [INCEPTION],
    });
  });

  it("refuses a statement that does not verify", async () => {
    vi.mocked(signPluginManifest).mockResolvedValue({
      ...SIGNED_HELLO_WEB,
      payload: SIGNED_HELLO_WEB.payload.replace("Ada", "Eve"),
    });
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <SignAndPublishDialog plugin={installedHello()} identity={identity} onClose={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText(SHA);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    });
    expect(await screen.findByText("signature does not verify")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("exports a signature file with the built bundle for anyone else", async () => {
    role.moderator = false;
    await signIt();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    });
    const [stem, signature, bundle, beside] = vi.mocked(exportSignature).mock.calls[0];
    expect(stem).toBe("dev.example.hello-web-0.1.0");
    expect(readSignatureFile(signature)).toEqual({
      statement: SIGNED_HELLO_WEB,
      publisherKeyLog: [INCEPTION],
    });
    expect(bundle).toBe(builtSource().bundle);
    expect(beside).toBeNull();
  });

  it("offers only the signature file while workspace plugins are switched off", async () => {
    await signIt({ workspace_plugins: ServerFeatureState.DISABLED });
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export…" })).toBeInTheDocument();
  });
});
