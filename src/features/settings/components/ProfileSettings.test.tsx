import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { server } from "../../../test/mocks/server";
import { serverInfoQueryClient, type FakeFeatures } from "../../../test/serverInfo";

vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: {
      id: "u1",
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
      statusText: null,
      bio: null,
    },
    isPending: false,
  }),
}));

import { ProfileSettings } from "./ProfileSettings";

function renderProfile(client: QueryClient) {
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ProfileSettings />, { wrapper: Providers });
}

function renderWithFeatures(features: FakeFeatures = {}) {
  return renderProfile(serverInfoQueryClient(features));
}

function filePicker(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector('input[type="file"]');
}

describe("ProfileSettings and the avatars switch", () => {
  it("opens the file picker from the avatar while the server runs profile pictures", () => {
    const { container } = renderWithFeatures();
    const picker = filePicker(container);
    expect(picker).not.toBeNull();
    const click = vi.spyOn(picker!, "click");

    fireEvent.click(screen.getByTitle("Change avatar"));

    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/click to upload avatar/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the initial and a notice, with no upload, while the operator switched them off", () => {
    const { container } = renderWithFeatures({ avatars: ServerFeatureState.DISABLED });

    expect(screen.queryByTitle("Change avatar")).not.toBeInTheDocument();
    expect(filePicker(container)).toBeNull();
    expect(screen.queryByText(/click to upload avatar/i)).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Profile pictures are switched off on this server.",
    );
  });

  it("keeps the upload while the server's features cannot be read", async () => {
    server.use(http.post("*/api", () => HttpResponse.error()));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderProfile(client);

    await waitFor(() => expect(client.getQueryState(queryKeys.serverInfo)?.status).toBe("error"));
    expect(screen.getByTitle("Change avatar")).toBeInTheDocument();
    expect(filePicker(container)).not.toBeNull();
  });
});
