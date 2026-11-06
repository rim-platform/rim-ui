import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import type { DisplayDensity } from "../../../shell/state/useShellStore";
import { MessageItem } from "./MessageItem";
import type { MessageItemHandlers } from "./MessageItem";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: () => new Promise(() => {}) },
}));

const handlers: MessageItemHandlers = {
  onOpenThread: vi.fn(),
  onToggleReaction: vi.fn(),
  onContextMenu: vi.fn(),
};

function row(isBot: boolean, displayDensity: DisplayDensity) {
  return (
    <MessageItem
      view={{
        message: {
          id: "m1",
          text: "Build finished",
          authorId: "bot-1",
          sentAt: "2026-11-01T12:00:00Z",
          reactions: [],
        },
        author: {
          name: "Helper",
          isCurrentUser: false,
          isBot,
          role: "GUEST",
        },
        displayDensity,
      }}
      handlers={handlers}
    />
  );
}

describe("MessageItem author mark", () => {
  it.each(["comfortable", "compact", "ultra-compact"] as const)(
    "marks a bot's message as a bot's in the %s layout",
    (density) => {
      render(row(true, density));
      expect(screen.getByTestId("bot-badge")).toHaveTextContent("Bot");
      expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
    },
  );

  it("puts the mark before the colon in the ultra-compact layout", () => {
    render(row(true, "ultra-compact"));
    const name = screen.getByText(/^Helper/);
    expect(name.textContent).toBe("HelperBot:");
  });

  it.each(["comfortable", "compact", "ultra-compact"] as const)(
    "marks nothing on a person's message in the %s layout",
    (density) => {
      render(row(false, density));
      expect(screen.queryByTestId("bot-badge")).not.toBeInTheDocument();
    },
  );
});
