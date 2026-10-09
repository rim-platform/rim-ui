import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { tauri } = vi.hoisted(() => ({ tauri: { available: true } }));
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  isTauri: () => tauri.available,
}));

const mockRequestCacheSync = vi.fn();
vi.mock("../../messages/runtime/messageCacheSync", () => ({
  requestCacheSync: (...args: unknown[]) => mockRequestCacheSync(...args),
}));

const identityBackup = vi.hoisted(() => ({
  backUpIdentityKeyQuietly: vi.fn(),
  canUnlockArchiveWithKeys: vi.fn(),
  unlockArchiveWithKeys: vi.fn(),
}));
vi.mock("../../key-identity/api/identityBackup", () => identityBackup);

import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { ArchiveStatus } from "../api/historyArchive";
import { HistoryArchiveSettings } from "./HistoryArchiveSettings";
import { describeExport, describeRestore } from "./archiveReports";

const unconfigured: ArchiveStatus = {
  configured: false,
  provider: null,
  folder: null,
  archiveId: null,
  deviceId: "0f0e0d0c-aaaa-4bbb-8ccc-123456789abc",
  unlocked: false,
};
const connected: ArchiveStatus = {
  ...unconfigured,
  configured: true,
  provider: "localFolder",
  folder: "/home/ada/Dropbox/RIM",
  archiveId: "11111111-2222-4333-8444-555555555555",
  unlocked: true,
};

const inDrive: ArchiveStatus = {
  ...connected,
  provider: "googleDrive",
  folder: "ada@example.com",
};
const noCloud = [
  { kind: "googleDrive", available: false },
  { kind: "dropbox", available: false },
];
const bothClouds = [
  { kind: "googleDrive", available: true },
  { kind: "dropbox", available: true },
];

/**
 * Answers Tauri commands by name; a function value is called with the command's args. This
 * build offers no cloud service unless `answers` says otherwise.
 */
function backend(answers: Record<string, unknown>) {
  answers = { history_archive_cloud_services: noCloud, ...answers };
  mockInvoke.mockImplementation(async (command: string, args: unknown) => {
    if (!(command in answers)) throw new Error(`unexpected command ${command}`);
    const answer = answers[command];
    return typeof answer === "function" ? answer(args) : answer;
  });
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <HistoryArchiveSettings />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("HistoryArchiveSettings", () => {
  beforeEach(() => {
    tauri.available = true;
    mockInvoke.mockReset();
    mockRequestCacheSync.mockReset();
    Object.values(identityBackup).forEach((fn) => fn.mockReset());
    identityBackup.backUpIdentityKeyQuietly.mockResolvedValue(undefined);
    identityBackup.canUnlockArchiveWithKeys.mockResolvedValue(false);
    useAuthStore.setState({ session: { userId: "ada" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  it("explains that the archive is a desktop feature in the web app", () => {
    tauri.available = false;
    renderSettings();
    expect(screen.getByText(/available in the desktop app/)).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("starts a new archive in an empty folder with a confirmed passphrase", async () => {
    const connect = vi.fn(() => ({ status: connected, created: true }));
    backend({
      history_archive_status: unconfigured,
      history_archive_pick_folder: "/home/ada/Dropbox/RIM",
      history_archive_inspect_folder: { hasArchive: false, version: null },
      history_archive_connect: connect,
      history_archive_export: { segments: 1, messages: 10, conversations: 2 },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Choose folder/ }));
    await screen.findByText(/Set a passphrase/);
    const create = screen.getByRole("button", { name: "Create archive" });

    type("Passphrase", "short");
    expect(screen.getByText(/more characters needed/)).toBeInTheDocument();
    expect(create).toBeDisabled();

    type("Passphrase", "correct horse battery staple");
    type("Repeat passphrase", "correct horse battery stapler");
    expect(screen.getByText("The passphrases do not match.")).toBeInTheDocument();
    expect(create).toBeDisabled();

    type("Repeat passphrase", "correct horse battery staple");
    fireEvent.click(create);

    expect(await screen.findByText("Backing up to")).toBeInTheDocument();
    expect(connect).toHaveBeenCalledWith({
      account: { endpoint: expect.any(String), userId: "ada" },
      target: { kind: "localFolder", path: "/home/ada/Dropbox/RIM" },
      passphrase: "correct horse battery staple",
    });
    // A new archive has nothing to restore; this device's first backup starts at once.
    expect(mockInvoke).not.toHaveBeenCalledWith("history_archive_restore", expect.anything());
    expect(mockInvoke).toHaveBeenCalledWith("history_archive_export", expect.anything());
    expect(identityBackup.backUpIdentityKeyQuietly).toHaveBeenCalled();
  });

  it("joins an existing archive with its passphrase and restores from it", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_pick_folder: "/mnt/usb/rim",
      history_archive_inspect_folder: { hasArchive: true, version: 1 },
      history_archive_connect: { status: connected, created: false },
      history_archive_export: { segments: 0, messages: 0, conversations: 0 },
      history_archive_restore: {
        devices: 2,
        segmentsRead: 5,
        segmentsMissing: 0,
        segmentsDamaged: 0,
        messages: 120,
        conversations: 4,
      },
    });
    const { invalidate } = renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Choose folder/ }));
    await screen.findByText(/already holds a RIM history archive/);
    expect(screen.queryByLabelText("Repeat passphrase")).not.toBeInTheDocument();
    type("Passphrase", "any length");
    fireEvent.click(screen.getByRole("button", { name: "Connect and restore" }));

    expect(await screen.findByText("Backing up to")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("history_archive_restore", {
      account: { endpoint: expect.any(String), userId: "ada" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cachedTimeline"] });
    expect(mockRequestCacheSync).toHaveBeenCalledWith("ws-1");
    // What the restore found stays on screen after the panel switches.
    expect(screen.getByText(/Restored 120 messages in 4 new conversations/)).toBeInTheDocument();
  });

  it("keeps a failed restore visible after joining", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_pick_folder: "/mnt/usb/rim",
      history_archive_inspect_folder: { hasArchive: true, version: 1 },
      history_archive_connect: { status: connected, created: false },
      history_archive_export: { segments: 0, messages: 0, conversations: 0 },
      history_archive_restore: () => {
        throw { kind: "ARCHIVE_UNAVAILABLE", message: "archive folder unavailable" };
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Choose folder/ }));
    await screen.findByText(/already holds a RIM history archive/);
    type("Passphrase", "any length");
    fireEvent.click(screen.getByRole("button", { name: "Connect and restore" }));

    expect(await screen.findByText("Backing up to")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be reached");
  });

  it("counts a passphrase in characters, as the archive does", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_pick_folder: "/home/ada/RIM",
      history_archive_inspect_folder: { hasArchive: false, version: null },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Choose folder/ }));
    await screen.findByText(/Set a passphrase/);
    // Six emoji are twelve UTF-16 units but six characters: too short.
    type("Passphrase", "🔑🔑🔑🔑🔑🔑");
    type("Repeat passphrase", "🔑🔑🔑🔑🔑🔑");
    expect(screen.getByText("6 more characters needed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create archive" })).toBeDisabled();
  });

  it("refuses a folder this device cannot write into", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_pick_folder: "/media/cdrom",
      history_archive_inspect_folder: () => {
        throw { kind: "ARCHIVE_NOT_WRITABLE", message: "cannot write" };
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Choose folder/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "RIM cannot write into this folder.",
    );
    expect(screen.queryByLabelText("Passphrase")).not.toBeInTheDocument();
  });

  it("shows a wrong passphrase and stays on the form", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_pick_folder: "/mnt/usb/rim",
      history_archive_inspect_folder: { hasArchive: true, version: 1 },
      history_archive_connect: () => {
        throw { kind: "ARCHIVE_WRONG_PASSPHRASE", message: "wrong passphrase" };
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Choose folder/ }));
    await screen.findByText(/already holds a RIM history archive/);
    type("Passphrase", "not it");
    fireEvent.click(screen.getByRole("button", { name: "Connect and restore" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That passphrase does not open this archive.",
    );
    expect(screen.getByRole("button", { name: "Connect and restore" })).toBeInTheDocument();
  });

  it("backs up and restores on demand once connected", async () => {
    backend({
      history_archive_status: connected,
      history_archive_export: { segments: 2, messages: 40, conversations: 3 },
      history_archive_restore: {
        devices: 1,
        segmentsRead: 2,
        segmentsMissing: 1,
        segmentsDamaged: 0,
        messages: 0,
        conversations: 0,
      },
    });
    renderSettings();

    expect(await screen.findByText("/home/ada/Dropbox/RIM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByText("Backed up 40 message changes in 2 files.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore from archive" }));
    expect(await screen.findByText(/1 file has not synced/)).toBeInTheDocument();
  });

  it("asks for the passphrase when this device lost the key, then unlocks", async () => {
    backend({
      history_archive_status: { ...connected, unlocked: false },
      history_archive_unlock: connected,
    });
    renderSettings();

    expect(await screen.findByText("Archive locked on this device")).toBeInTheDocument();
    type("Passphrase", "correct horse battery staple");
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Backing up to")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unlock with this device's keys" }),
    ).not.toBeInTheDocument();
    // The identity key is backed up to the archive it can now write to.
    expect(identityBackup.backUpIdentityKeyQuietly).toHaveBeenCalled();
  });

  it("unlocks with this device's keys when its identity key opens the archive", async () => {
    backend({ history_archive_status: { ...connected, unlocked: false } });
    identityBackup.canUnlockArchiveWithKeys.mockResolvedValue(true);
    identityBackup.unlockArchiveWithKeys
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "backend_error", code: "ARCHIVE_NO_IDENTITY_WRAP", message: "no wrap" },
      })
      .mockResolvedValueOnce({ ok: true, value: connected });
    renderSettings();

    const withKeys = await screen.findByRole("button", { name: "Unlock with this device's keys" });
    expect(identityBackup.canUnlockArchiveWithKeys).toHaveBeenCalledWith({
      endpoint: expect.any(String),
      userId: "ada",
    });
    fireEvent.click(withKeys);
    expect(await screen.findByRole("alert")).toHaveTextContent(/keys do not open this archive/);

    fireEvent.click(screen.getByRole("button", { name: "Unlock with this device's keys" }));
    expect(await screen.findByText("Backing up to")).toBeInTheDocument();
    expect(identityBackup.unlockArchiveWithKeys).toHaveBeenCalledTimes(2);
  });

  it("stops backing up and offers the setup again", async () => {
    let status = connected;
    backend({
      history_archive_status: () => status,
      history_archive_disconnect: () => {
        status = unconfigured;
        return null;
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Stop backing up" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Choose folder/ })).toBeInTheDocument(),
    );
  });

  it("offers only the cloud services this build can sign in to", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_cloud_services: [
        { kind: "googleDrive", available: true },
        { kind: "dropbox", available: false },
      ],
    });
    renderSettings();

    expect(await screen.findByRole("button", { name: /Google Drive/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dropbox/ })).not.toBeInTheDocument();
  });

  it("signs in to Google Drive and starts an archive there", async () => {
    const connect = vi.fn(() => ({ status: inDrive, created: true }));
    backend({
      history_archive_status: unconfigured,
      history_archive_cloud_services: bothClouds,
      history_archive_cloud_authorize: {
        connectionId: "conn-1",
        kind: "googleDrive",
        account: "ada@example.com",
        hasArchive: false,
        version: null,
      },
      history_archive_connect: connect,
      history_archive_export: { segments: 0, messages: 0, conversations: 0 },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Google Drive/ }));
    expect(await screen.findByText("Google Drive (ada@example.com)")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("history_archive_cloud_authorize", {
      kind: "googleDrive",
    });
    type("Passphrase", "correct horse battery staple");
    type("Repeat passphrase", "correct horse battery staple");
    fireEvent.click(screen.getByRole("button", { name: "Create archive" }));

    expect(await screen.findByText("Backing up to")).toBeInTheDocument();
    expect(connect).toHaveBeenCalledWith({
      account: { endpoint: expect.any(String), userId: "ada" },
      target: { kind: "cloud", connectionId: "conn-1" },
      passphrase: "correct horse battery staple",
    });
    expect(screen.getByText("Google Drive (ada@example.com)")).toBeInTheDocument();
    expect(screen.getByText(/signs this device out of Google Drive/)).toBeInTheDocument();
    // The sign-in now belongs to the archive: it is not dropped when the form goes away.
    expect(mockInvoke).not.toHaveBeenCalledWith("history_archive_cloud_discard", expect.anything());
  });

  it("joins an archive found in Dropbox and restores from it", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_cloud_services: bothClouds,
      history_archive_cloud_authorize: {
        connectionId: "conn-2",
        kind: "dropbox",
        account: "ada@example.com",
        hasArchive: true,
        version: 1,
      },
      history_archive_connect: { status: { ...inDrive, provider: "dropbox" }, created: false },
      history_archive_export: { segments: 0, messages: 0, conversations: 0 },
      history_archive_restore: {
        devices: 1,
        segmentsRead: 1,
        segmentsMissing: 0,
        segmentsDamaged: 0,
        messages: 7,
        conversations: 1,
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Dropbox/ }));
    await screen.findByText(/This account already holds a RIM history archive/);
    type("Passphrase", "correct horse battery staple");
    fireEvent.click(screen.getByRole("button", { name: "Connect and restore" }));

    expect(await screen.findByText(/Restored 7 messages/)).toBeInTheDocument();
    expect(screen.getByText("Dropbox (ada@example.com)")).toBeInTheDocument();
  });

  it("waits for the browser, and a cancelled sign-in shows no error", async () => {
    let finish: (value: unknown) => void = () => {};
    backend({
      history_archive_status: unconfigured,
      history_archive_cloud_services: bothClouds,
      history_archive_cloud_authorize: () =>
        new Promise((_, reject) => {
          finish = reject;
        }),
      history_archive_cloud_cancel: () => {
        finish({ kind: "ARCHIVE_CANCELLED", message: "sign-in cancelled" });
        return null;
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Dropbox/ }));
    expect(await screen.findByText(/Finish signing in to Dropbox/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose folder/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText(/Finish signing in/)).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose folder/ })).toBeEnabled();
  });

  it("drops an unused cloud sign-in when a folder is chosen instead", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_cloud_services: bothClouds,
      history_archive_cloud_authorize: {
        connectionId: "conn-3",
        kind: "googleDrive",
        account: "ada@example.com",
        hasArchive: false,
        version: null,
      },
      history_archive_cloud_discard: null,
      history_archive_pick_folder: "/home/ada/RIM",
      history_archive_inspect_folder: { hasArchive: false, version: null },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Google Drive/ }));
    await screen.findByText("Google Drive (ada@example.com)");
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    expect(await screen.findByText("/home/ada/RIM")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("history_archive_cloud_discard", {
      connectionId: "conn-3",
    });
  });

  it("explains a failed sign-in", async () => {
    backend({
      history_archive_status: unconfigured,
      history_archive_cloud_services: bothClouds,
      history_archive_cloud_authorize: () => {
        throw { kind: "ARCHIVE_CLOUD_AUTH", message: "cloud sign-in: Dropbox refused the sign-in" };
      },
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Dropbox/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
  });
});

describe("report wording", () => {
  it("describes exports", () => {
    expect(describeExport({ segments: 0, messages: 0, conversations: 0 })).toBe(
      "Already up to date.",
    );
    expect(describeExport({ segments: 1, messages: 1, conversations: 1 })).toBe(
      "Backed up 1 message change in 1 file.",
    );
  });

  it("describes restores, with what is still missing", () => {
    expect(
      describeRestore({
        devices: 2,
        segmentsRead: 3,
        segmentsMissing: 2,
        segmentsDamaged: 1,
        messages: 1,
        conversations: 1,
      }),
    ).toBe(
      "Restored 1 message in 1 new conversation from 2 devices. 2 files have not synced to this folder yet; restore again later to pick them up. 1 file could not be read and was skipped.",
    );
  });
});
