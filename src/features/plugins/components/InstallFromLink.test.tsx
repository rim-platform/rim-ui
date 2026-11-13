import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: vi.fn(() => ({ platform: "web" })),
}));
const fetchLinkBundle = vi.hoisted(() => vi.fn());
vi.mock("../api/usePluginActions", () => ({
  fetchLinkBundle,
  usePluginInstallFromLink: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import { InstallFromLink, isGithubRepositoryLink } from "./InstallFromLink";

describe("isGithubRepositoryLink", () => {
  it("accepts a repository page with or without .git or a trailing slash", () => {
    expect(isGithubRepositoryLink("https://github.com/rim-platform/plugin-poll")).toBe(true);
    expect(isGithubRepositoryLink("https://github.com/rim-platform/plugin-poll/")).toBe(true);
    expect(isGithubRepositoryLink("https://github.com/rim-platform/plugin-poll.git")).toBe(true);
  });

  it("leaves release pages, assets and other hosts alone", () => {
    expect(
      isGithubRepositoryLink("https://github.com/rim-platform/plugin-poll/releases/latest"),
    ).toBe(false);
    expect(
      isGithubRepositoryLink(
        "https://github.com/rim-platform/plugin-poll/releases/download/v1/p.rimbundle#sha256=ab",
      ),
    ).toBe(false);
    expect(isGithubRepositoryLink("https://example.com/a/b")).toBe(false);
  });
});

describe("InstallFromLink", () => {
  function paste(value: string) {
    render(<InstallFromLink installed={[]} onInstalled={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /install from link/i }));
    fireEvent.change(screen.getByLabelText("Plugin bundle link"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
  }

  it("says a repository link is not the bundle link, without fetching", () => {
    fetchLinkBundle.mockReset();
    paste("https://github.com/rim-platform/plugin-poll");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That's the plugin's repository. Open its latest release and copy the link under Install from link.",
    );
    expect(fetchLinkBundle).not.toHaveBeenCalled();
  });

  it("still fetches any other link, whose own error then shows", async () => {
    fetchLinkBundle
      .mockReset()
      .mockRejectedValue(new Error("A plugin link must end with #sha256="));
    paste("https://example.com/p.rimbundle");
    expect(await screen.findByRole("alert")).toHaveTextContent("must end with #sha256=");
  });
});
