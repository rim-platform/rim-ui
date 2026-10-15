import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { KEY_PRINCIPAL } from "../../../test/keyIdentity";

const api = vi.hoisted(() => ({ fetchMyKeyIdentity: vi.fn(), syncKeyLog: vi.fn() }));
const capabilities = vi.hoisted(() => ({ identityKeys: true, pluginSigning: false }));

vi.mock("../../key-identity/api/keyIdentity", () => api);
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities }),
}));

import { usePluginSigning } from "./signing";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.fetchMyKeyIdentity.mockReset().mockResolvedValue({ principalId: KEY_PRINCIPAL, keySeq: 0 });
  api.syncKeyLog.mockReset().mockResolvedValue({ holdsIdentityKey: true });
});

describe("usePluginSigning", () => {
  it("never signs in the web app, even where the browser holds the identity key", async () => {
    capabilities.pluginSigning = false;
    const { result } = renderHook(() => usePluginSigning(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.canSign).toBe(false);
    expect(api.fetchMyKeyIdentity).not.toHaveBeenCalled();
    expect(api.syncKeyLog).not.toHaveBeenCalled();
  });

  it("signs on the desktop when it holds the identity key", async () => {
    capabilities.pluginSigning = true;
    const { result } = renderHook(() => usePluginSigning(), { wrapper });
    await waitFor(() => expect(result.current.canSign).toBe(true));
  });
});
