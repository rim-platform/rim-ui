import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { useResolvedKeybinds } from "./useKeybinds";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("useResolvedKeybinds", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ resolvedKeybinds: [] });
    startRelayWithDirectSpace();
  });

  afterEach(() => useRelayStore.getState().reset());

  it("asks for the viewer's own keybinds, without a workspace, in a direct space", async () => {
    const { result } = renderHook(() => useResolvedKeybinds(DIRECT_SPACE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][1]).toEqual({ workspaceId: undefined });
  });
});
