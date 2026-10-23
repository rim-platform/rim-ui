import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";

import { useAuthStore } from "../../auth/state/useAuthStore";
import { removalAccountKey, useRemovalNotices } from "../state/useRemovalNotices";
import { RemovalNotices } from "./RemovalNotices";

beforeEach(() => {
  useRemovalNotices.setState({ accounts: {} });
  useAuthStore.setState({ session: { userId: "alice" } });
});

it("keeps the readable removal reason across reload until dismissal", async () => {
  useRemovalNotices.getState().add(removalAccountKey("alice"), {
    workspaceId: "internal-id",
    workspaceName: "Lobby",
    cause: "ban",
    reason: "Please respect other members.",
  });
  const stored = localStorage.getItem("rim-workspace-removals");
  useRemovalNotices.setState({ accounts: {} });
  localStorage.setItem("rim-workspace-removals", stored!);
  await act(() => useRemovalNotices.persist.rehydrate());
  render(<RemovalNotices />);
  expect(screen.getByText("You were banned from Lobby")).toBeInTheDocument();
  expect(screen.getByText("Reason: Please respect other members.")).toBeInTheDocument();
  expect(screen.queryByText(/internal-id/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss removal notice" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows reasons only for the signed-in account and renders them as text", () => {
  useRemovalNotices
    .getState()
    .add(removalAccountKey("bob"), { workspaceId: "w", cause: "kick", reason: "private" });
  const { container } = render(<RemovalNotices />);
  expect(screen.queryByText(/private/)).not.toBeInTheDocument();
  act(() => useAuthStore.setState({ session: { userId: "bob" } }));
  expect(screen.getByText("Reason: private")).toBeInTheDocument();
  act(() =>
    useRemovalNotices.getState().add(removalAccountKey("bob"), {
      workspaceId: "w",
      cause: "ban",
      reason: "<script>alert(1)</script>",
    }),
  );
  expect(screen.getByText("Reason: <script>alert(1)</script>")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
});
