import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { LIMITS_USER_ID, limitsQueryClient } from "../../../test/limits";
import { server } from "../../../test/mocks/server";
import { serverInfoQueryClient, type FakeFeatures } from "../../../test/serverInfo";
import { probationText } from "../../limits/limits";

const currentUser = vi.hoisted(() => ({
  data: {
    id: "u1",
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    statusText: null,
    bio: null,
  },
  isPending: false,
}));

vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => currentUser,
}));

vi.mock("../utils/resizeImage", () => ({
  resizeImageToBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

import { resizeImageToBlob } from "../utils/resizeImage";
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

const HOUR = 60 * 60_000;

/** A client signed in as `LIMITS_USER_ID`, in probation until `probationEndsAt` and locked until `lockedUntil`. */
function restrictedClient({
  probationEndsAt,
  lockedUntil = null,
}: {
  probationEndsAt?: string;
  lockedUntil?: string | null;
}): QueryClient {
  const client = limitsQueryClient({}, probationEndsAt);
  client.setQueryData(queryKeys.profileLock(LIMITS_USER_ID), lockedUntil);
  return client;
}

describe("ProfileSettings during probation and a lock", () => {
  it("keeps the display name but not the picture, status or bio during probation", () => {
    const endsAt = new Date(Date.now() + HOUR).toISOString();
    const { container } = renderProfile(restrictedClient({ probationEndsAt: endsAt }));

    expect(screen.getByTestId("profile-restriction")).toHaveTextContent(
      probationText("set a profile picture, bio or status", endsAt),
    );
    expect(screen.getByTitle("Change avatar")).toBeDisabled();
    expect(filePicker(container)).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByLabelText("Bio")).toBeDisabled();
    expect(screen.getByLabelText("Display name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("says nothing about uploading a picture during probation", () => {
    const endsAt = new Date(Date.now() + HOUR).toISOString();
    renderProfile(restrictedClient({ probationEndsAt: endsAt }));

    expect(screen.queryByText(/Click to upload avatar/)).toBeNull();
  });

  it("saves only the display name during probation", async () => {
    const sent = vi.fn();
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as {
          operationName?: string;
          variables?: Record<string, unknown>;
        };
        if (body.operationName !== "UpdateMyProfile") return undefined;
        sent(body.variables);
        return HttpResponse.json({
          data: {
            updateMyProfile: {
              id: "u1",
              username: "alice",
              displayName: "Alicia",
              avatarUrl: null,
              statusText: null,
              bio: null,
            },
          },
        });
      }),
    );
    const endsAt = new Date(Date.now() + HOUR).toISOString();
    renderProfile(restrictedClient({ probationEndsAt: endsAt }));

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alicia" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(sent).toHaveBeenCalledWith({ input: { displayName: "Alicia" } });
  });

  it("disables every field, the picture and Save while the operators lock the profile", () => {
    const lockedUntil = new Date(Date.now() + 24 * HOUR).toISOString();
    const { container } = renderProfile(restrictedClient({ lockedUntil }));

    expect(screen.getByTestId("profile-restriction")).toHaveTextContent(
      `This server's operators locked your profile until ${new Date(lockedUntil).toLocaleString()}.`,
    );
    expect(screen.getByTitle("Change avatar")).toBeDisabled();
    expect(filePicker(container)).toBeDisabled();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByLabelText("Bio")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows no note and keeps everything editable once a lock has ended", () => {
    const lockedUntil = new Date(Date.now() - HOUR).toISOString();
    renderProfile(restrictedClient({ lockedUntil }));

    expect(screen.queryByTestId("profile-restriction")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeEnabled();
    expect(screen.getByLabelText("Bio")).toBeEnabled();
    expect(screen.getByTitle("Change avatar")).toBeEnabled();
  });

  it("asks a server too old to lock profiles nothing it refuses twice and keeps the form", async () => {
    let asked = 0;
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName !== "MeProfileLock") return undefined;
        asked += 1;
        return HttpResponse.json({
          errors: [{ message: 'Unknown field "profileLockedUntil" on type "User".' }],
        });
      }),
    );
    const client = limitsQueryClient();
    renderProfile(client);

    await waitFor(() =>
      expect(client.getQueryState(queryKeys.profileLock(LIMITS_USER_ID))?.status).toBe("success"),
    );
    expect(asked).toBe(1);
    expect(screen.queryByTestId("profile-restriction")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeEnabled();
  });
});

describe("ProfileSettings picture upload", () => {
  it("accepts a 5 MB photo and uploads it resized", async () => {
    const uploaded = vi.fn();
    server.use(
      http.post("*/api/files/avatar", () => {
        uploaded();
        return HttpResponse.json({ url: "/api/files/avatars/u1/avatar.png" });
      }),
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName !== "UpdateMyProfile") return undefined;
        return HttpResponse.json({
          data: {
            updateMyProfile: {
              id: "u1",
              username: "alice",
              displayName: "Alice",
              avatarUrl: "/api/files/avatars/u1/avatar.png",
              statusText: null,
              bio: null,
            },
          },
        });
      }),
    );
    const { container } = renderProfile(restrictedClient({}));
    const photo = new File([new Uint8Array(5 * 1024 * 1024)], "photo.jpg", { type: "image/jpeg" });

    fireEvent.change(filePicker(container)!, { target: { files: [photo] } });

    await waitFor(() => expect(uploaded).toHaveBeenCalledTimes(1));
    expect(resizeImageToBlob).toHaveBeenCalledWith(photo, 256);
    expect(screen.queryByText(/must be under/)).not.toBeInTheDocument();
  });

  it("refuses a file over 10 MB before resizing it", () => {
    vi.mocked(resizeImageToBlob).mockClear();
    const { container } = renderProfile(restrictedClient({}));
    const photo = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(filePicker(container)!, { target: { files: [photo] } });

    expect(screen.getByText("Image must be under 10MB.")).toBeInTheDocument();
    expect(resizeImageToBlob).not.toHaveBeenCalled();
  });
});
