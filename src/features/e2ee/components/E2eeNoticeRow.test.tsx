import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

const archive = vi.hoisted(() => ({ getArchiveStatus: vi.fn(), restoreArchive: vi.fn() }));
vi.mock("../../history-archive/api/historyArchive", () => archive);
vi.mock("../../messages/api/messageCache", () => ({
  currentCacheAccount: () => ({ endpoint: "http://x/api", userId: "u" }),
}));

import { renderWithProviders } from "../../../test/utils";
import { E2eeNoticeRow } from "./E2eeNoticeRow";

const names = {
  nameOf: (p: string | null | undefined) => (p === "rimp1_bob" ? "Bob" : "Someone"),
  deviceNameOf: (d: string | null | undefined) => (d === "dev-b" ? "Laptop" : "device"),
};

describe("E2eeNoticeRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks where the conversation became encrypted", () => {
    renderWithProviders(<E2eeNoticeRow notice={{ kind: "encryptedFrom" }} {...names} />);
    expect(screen.getByText("Messages from here on are end-to-end encrypted")).toBeInTheDocument();
  });

  it("says who reset the encryption", () => {
    renderWithProviders(
      <E2eeNoticeRow
        notice={{ kind: "reset", incarnation: 2, principalId: "rimp1_bob", deviceId: "dev-b" }}
        {...names}
      />,
    );
    expect(screen.getByText("Encryption was reset by Bob's Laptop")).toBeInTheDocument();
  });

  it("finding 4: says who was added or removed", () => {
    renderWithProviders(
      <E2eeNoticeRow
        notice={{ kind: "member", change: "added", principalId: "rimp1_bob" }}
        {...names}
      />,
    );
    renderWithProviders(
      <E2eeNoticeRow
        notice={{ kind: "member", change: "removed", principalId: "rimp1_bob" }}
        {...names}
      />,
    );
    expect(screen.getByText("Bob was added")).toBeInTheDocument();
    expect(screen.getByText("Bob was removed")).toBeInTheDocument();
  });

  it("collapses earlier messages and offers a restore when an archive is set up", async () => {
    archive.getArchiveStatus.mockResolvedValue({
      ok: true,
      value: { configured: true, unlocked: true },
    });
    archive.restoreArchive.mockResolvedValue({
      ok: true,
      value: { messages: 3, conversations: 0, devices: 1, segmentsMissing: 0, segmentsDamaged: 0 },
    });
    const onRestored = vi.fn();
    renderWithProviders(
      <E2eeNoticeRow notice={{ kind: "earlier", count: 3 }} {...names} onRestored={onRestored} />,
    );
    expect(
      screen.getByText(/Earlier messages were sent before this device joined/),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Restore from history archive"));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(archive.restoreArchive).toHaveBeenCalled();
  });

  it("offers no restore without an archive", async () => {
    archive.getArchiveStatus.mockResolvedValue({ ok: true, value: { configured: false } });
    renderWithProviders(<E2eeNoticeRow notice={{ kind: "earlier", count: 1 }} {...names} />);
    await waitFor(() => expect(archive.getArchiveStatus).toHaveBeenCalled());
    expect(screen.queryByText("Restore from history archive")).not.toBeInTheDocument();
  });
});
