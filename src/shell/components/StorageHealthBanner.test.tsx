import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useStorageHealthStore } from "../../core/storageHealth";
import { STORAGE_HELP_URL, StorageHealthBanner } from "./StorageHealthBanner";

describe("StorageHealthBanner", () => {
  beforeEach(() => {
    useStorageHealthStore.setState({ failures: {} });
  });

  it("shows nothing while every store saves", () => {
    const { container } = render(<StorageHealthBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says what is lost at restart and links to what to do once a store failed", () => {
    render(<StorageHealthBanner />);
    act(() => useStorageHealthStore.setState({ failures: { relay: "UnknownError: x" } }));
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(
      "RIM can't save on this device. Connected agents, drafts and assistant conversations will be gone after RIM restarts.",
    );
    expect(screen.getByRole("link", { name: "What to do" })).toHaveAttribute(
      "href",
      STORAGE_HELP_URL,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
