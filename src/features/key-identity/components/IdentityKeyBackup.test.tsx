import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import type { IdentityBackupStatus } from "../api/identityBackup";
import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  syncIdentityBackup: vi.fn(),
  enableIdentityBackup: vi.fn(),
  takeOverIdentityKey: vi.fn(),
}));

vi.mock("../api/identityBackup", () => ({
  ...api,
  IdentityBackupErrorCode: {
    NOT_FOUND: "IDENTITY_BACKUP_NOT_FOUND",
    UNREADABLE: "IDENTITY_BACKUP_UNREADABLE",
    STALE: "IDENTITY_BACKUP_STALE",
  },
}));

import { IdentityKeyBackup } from "./IdentityKeyBackup";

const identity: MyKeyIdentity = {
  principalId: "rimp1_alice",
  keySeq: 2,
  keyLog: [],
  devices: [],
  profileCard: null,
};

const PHRASE = "abandon amount liar amount expire adjust cage candy arch gather drum buyer";

const ready: IdentityBackupStatus = {
  archive: "ready",
  holdsIdentityKey: true,
  hasBackupKey: true,
  backedUp: true,
  wrapped: true,
};
const linkedDevice: IdentityBackupStatus = {
  archive: "ready",
  holdsIdentityKey: false,
  hasBackupKey: false,
  backedUp: false,
  wrapped: false,
};

function renderBackup(holdsIdentityKey: boolean) {
  const qc = createTestQueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <IdentityKeyBackup
        identity={identity}
        principalId="rimp1_alice"
        holdsIdentityKey={holdsIdentityKey}
      />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function typePhrase(value: string) {
  fireEvent.change(screen.getByLabelText("Recovery phrase"), { target: { value } });
}

describe("IdentityKeyBackup", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it("says the archive holds a copy on the computer that backed the key up", async () => {
    api.syncIdentityBackup.mockResolvedValue(ready);
    renderBackup(true);
    expect(await screen.findByText(/holds a copy of the identity key/)).toBeInTheDocument();
    expect(api.syncIdentityBackup).toHaveBeenCalledWith(identity);
    expect(screen.queryByLabelText("Recovery phrase")).not.toBeInTheDocument();
  });

  it("turns the backup on with the recovery phrase where this computer cannot seal one", async () => {
    api.syncIdentityBackup.mockResolvedValue({ ...ready, hasBackupKey: false, backedUp: false });
    api.enableIdentityBackup.mockRejectedValueOnce(
      new Error("this recovery phrase or key does not belong to this account"),
    );
    api.enableIdentityBackup.mockResolvedValueOnce(ready);
    renderBackup(true);

    await screen.findByLabelText("Recovery phrase");
    typePhrase("wrong words");
    fireEvent.click(screen.getByRole("button", { name: "Turn on backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not belong to this account");

    typePhrase(PHRASE);
    fireEvent.click(screen.getByRole("button", { name: "Turn on backup" }));
    expect(await screen.findByText(/holds a copy of the identity key/)).toBeInTheDocument();
    expect(api.enableIdentityBackup).toHaveBeenLastCalledWith(identity, PHRASE);
  });

  it("points to the history settings when there is no archive to back up to", async () => {
    api.syncIdentityBackup.mockResolvedValue({ ...ready, archive: "notConfigured" });
    renderBackup(true);
    expect(await screen.findByText(/Set up the history archive/)).toBeInTheDocument();
  });

  it("takes the identity key over on a linked device with the recovery phrase", async () => {
    api.syncIdentityBackup.mockResolvedValue(linkedDevice);
    api.takeOverIdentityKey.mockResolvedValue({
      ok: true,
      value: { principalId: "rimp1_alice", seq: 2, holdsIdentityKey: true },
    });
    const { invalidate } = renderBackup(false);

    fireEvent.click(await screen.findByRole("button", { name: "Take over the identity key..." }));
    const submit = screen.getByRole("button", { name: "Take over" });
    expect(submit).toBeDisabled();
    typePhrase(PHRASE);
    fireEvent.click(submit);

    await waitFor(() => expect(api.takeOverIdentityKey).toHaveBeenCalledWith(identity, PHRASE));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deviceKeyStatus"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["myKeyIdentity"] });
    expect(screen.queryByLabelText("Recovery phrase")).not.toBeInTheDocument();
  });

  it("explains a backup older than the account's identity key and keeps the form", async () => {
    api.syncIdentityBackup.mockResolvedValue(linkedDevice);
    api.takeOverIdentityKey.mockResolvedValue({
      ok: false,
      error: { kind: "backend_error", code: "IDENTITY_BACKUP_STALE", message: "older" },
    });
    renderBackup(false);

    fireEvent.click(await screen.findByRole("button", { name: "Take over the identity key..." }));
    typePhrase(PHRASE);
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/older identity key/);
    expect(screen.getByLabelText("Recovery phrase")).toHaveValue(PHRASE);
  });

  it("closes the takeover form on cancel without sending the phrase", async () => {
    api.syncIdentityBackup.mockResolvedValue(linkedDevice);
    renderBackup(false);

    fireEvent.click(await screen.findByRole("button", { name: "Take over the identity key..." }));
    typePhrase(PHRASE);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Recovery phrase")).not.toBeInTheDocument();
    expect(api.takeOverIdentityKey).not.toHaveBeenCalled();
  });

  it("asks a linked device to set up the archive before it can take over", async () => {
    api.syncIdentityBackup.mockResolvedValue({ ...linkedDevice, archive: "notConfigured" });
    renderBackup(false);
    expect(await screen.findByText(/Set up the archive here first/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Take over the identity key..." }),
    ).not.toBeInTheDocument();
  });

  it("shows nothing outside the desktop app", async () => {
    api.syncIdentityBackup.mockResolvedValue(null);
    renderBackup(false);
    await waitFor(() => expect(api.syncIdentityBackup).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Identity key backup")).not.toBeInTheDocument());
  });
});
