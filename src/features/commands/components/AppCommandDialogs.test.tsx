import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("../../auth/components/SignOutDialog", () => ({
  SignOutDialog: ({ open }: { open: boolean }) => (open ? <p>sign-out dialog</p> : null),
}));
vi.mock("../../settings/components/StatusDropdown", () => ({
  StatusDropdown: () => <p>status menu</p>,
}));
vi.mock("../../workspaces/components/AddWorkspaceDialog", () => ({
  AddWorkspaceDialog: () => <p>add workspace dialog</p>,
}));
vi.mock("../../workspaces/components/ProfileCard", () => ({
  ProfileCard: ({ userId }: { userId: string }) => <p>profile of {userId}</p>,
}));

import { queryClient } from "../../../core/query/queryClient";
import { useAppDialogStore } from "../state/useAppDialogStore";
import { AppCommandDialogs } from "./AppCommandDialogs";

afterEach(() => act(() => useAppDialogStore.getState().close()));

describe("AppCommandDialogs", () => {
  it("shows nothing until a command opens a dialog, then the one it opened", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AppCommandDialogs />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/dialog|menu|profile/)).not.toBeInTheDocument();
    act(() => useAppDialogStore.getState().open("signOut"));
    expect(screen.getByText("sign-out dialog")).toBeInTheDocument();
    act(() => useAppDialogStore.getState().open("status"));
    expect(screen.getByText("status menu")).toBeInTheDocument();
    act(() => useAppDialogStore.getState().open("addWorkspace"));
    expect(screen.getByText("add workspace dialog")).toBeInTheDocument();
    act(() => useAppDialogStore.getState().open("profile", "u-9"));
    expect(screen.getByText("profile of u-9")).toBeInTheDocument();
    act(() => useAppDialogStore.getState().close());
    expect(screen.queryByText(/dialog|menu|profile/)).not.toBeInTheDocument();
  });
});
