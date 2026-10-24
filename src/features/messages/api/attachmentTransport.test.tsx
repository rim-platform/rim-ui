import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/utils";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { remoteFetch } from "../../relay/transport/remoteFetch";
import { MessageAttachments } from "../components/message-item/MessageAttachments";
import { followLink } from "../../../shared/ui/contextMenu/menuActions";
import { downloadAttachment } from "./attachmentDownloads";
import { uploadFileRest } from "./useAttachments";

vi.mock("../../relay/transport/remoteFetch", async (original) => ({
  ...(await original<typeof import("../../relay/transport/remoteFetch")>()),
  remoteFetch: vi.fn(),
}));
vi.mock("../../../shared/ui/contextMenu/menuActions", async (original) => ({
  ...(await original<typeof import("../../../shared/ui/contextMenu/menuActions")>()),
  followLink: vi.fn(),
}));

const createObjectURL = URL.createObjectURL;
const revokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  vi.mocked(remoteFetch).mockReset();
  vi.mocked(followLink).mockReset();
  useRelayStore.getState().addSpace({
    account: "account",
    spaceId: "remote-space",
    hostServerId: "host",
    kind: "workspace",
  });
  URL.createObjectURL = vi.fn(() => "blob:verified-host-file");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  useRelayStore.getState().reset();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

describe("remote attachments", () => {
  it("uploads multipart bytes to the workspace's host", async () => {
    vi.mocked(remoteFetch).mockResolvedValue({
      status: 204,
      body: new Uint8Array(),
      contentType: null,
    });
    await uploadFileRest(
      new File(["hello"], "notes.txt", { type: "text/plain" }),
      "token",
      "att-1",
      "remote-space",
    );
    expect(remoteFetch).toHaveBeenCalledWith(
      "host",
      "/api/files/upload",
      expect.objectContaining({
        method: "POST",
        contentType: expect.stringContaining("multipart/form-data;"),
      }),
    );
    const body = new TextDecoder().decode(vi.mocked(remoteFetch).mock.calls[0][2]?.body);
    expect(body).toContain("hello");
    expect(body).toContain("token");
    expect(body).toContain("att-1");
  });

  it("propagates a host verification failure without falling back to local bytes", async () => {
    vi.mocked(remoteFetch).mockRejectedValue(new Error("host signature invalid"));
    await expect(downloadAttachment("remote-space", "att-1")).rejects.toThrow(
      "host signature invalid",
    );
  });

  it("renders verified remote images and releases their object URL", async () => {
    vi.mocked(remoteFetch).mockResolvedValue({
      status: 200,
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    const { unmount } = renderWithProviders(
      <MessageAttachments
        serverId="remote-space"
        hasText
        attachments={[
          {
            id: "att-image",
            filename: "photo.png",
            contentType: "image/png",
            sizeBytes: 3,
            status: "READY",
          },
        ]}
      />,
    );
    expect(await screen.findByAltText("photo.png")).toHaveAttribute(
      "src",
      "blob:verified-host-file",
    );
    expect(remoteFetch).toHaveBeenCalledWith("host", "/api/attachments/att-image/download", {
      method: "GET",
    });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:verified-host-file");
  });

  it("downloads a file chip from its host instead of opening a local attachment", async () => {
    vi.mocked(remoteFetch).mockResolvedValue({
      status: 200,
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });
    renderWithProviders(
      <MessageAttachments
        serverId="remote-space"
        hasText
        attachments={[
          {
            id: "att-pdf",
            filename: "plan.pdf",
            contentType: "application/pdf",
            sizeBytes: 3,
            status: "READY",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: /plan.pdf/ }));
    await waitFor(() =>
      expect(followLink).toHaveBeenCalledWith("blob:verified-host-file", "plan.pdf"),
    );
    expect(remoteFetch).toHaveBeenCalledWith("host", "/api/attachments/att-pdf/download", {
      method: "GET",
    });
  });
});
