import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { fakeServerInfo } from "../../../test/serverInfo";
import { NEWER_SERVER_API_MESSAGE } from "../../updater/hooks/useServerInfo";
import { SERVER_ADDRESS_EMPTY, SERVER_ADDRESS_INSECURE } from "../api/serverAddress";

const runtime = vi.hoisted(() => ({ platform: "desktop" as "desktop" | "web" }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: runtime.platform }),
}));

const moved = vi.hoisted(() => ({ value: false }));
vi.mock("../../../core/graphql/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/graphql/config")>()),
  usesMovedRelay: () => moved.value,
}));

const fetchServerInfoAt = vi.hoisted(() => vi.fn());
vi.mock("../../updater/api/serverInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../updater/api/serverInfoApi")>()),
  fetchServerInfoAt,
}));

const switchServer = vi.hoisted(() => vi.fn());
vi.mock("../api/serverAddress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/serverAddress")>()),
  switchServer,
}));

import { ServerChoice } from "./ServerChoice";

beforeEach(() => {
  runtime.platform = "desktop";
  moved.value = false;
  fetchServerInfoAt.mockReset();
  switchServer.mockReset();
});

async function openWith(address: string) {
  const user = userEvent.setup();
  render(<ServerChoice />);
  await user.click(screen.getByRole("button", { name: "Use another server" }));
  if (address) await user.type(screen.getByRole("textbox", { name: /Server address/ }), address);
  await user.click(screen.getByRole("button", { name: "Check server" }));
  return user;
}

describe("ServerChoice", () => {
  it("shows nothing on the web, whose app its server serves", () => {
    runtime.platform = "web";
    const { container } = render(<ServerChoice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the server the desktop app signs in to, with no way back while on the default", () => {
    render(<ServerChoice />);
    expect(screen.getByText("localhost:8080")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another server" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back to the default server" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["", SERVER_ADDRESS_EMPTY],
    ["http://rim.example.org", SERVER_ADDRESS_INSECURE],
  ])("refuses the address %j without asking any server", async (address, error) => {
    await openWith(address);
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(fetchServerInfoAt).not.toHaveBeenCalled();
  });

  it("says so when no server answers, and moves nowhere", async () => {
    fetchServerInfoAt.mockRejectedValue(new Error("Failed to fetch"));
    await openWith("rim.example.org");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No RIM server answered at rim.example.org.",
    );
    expect(fetchServerInfoAt).toHaveBeenCalledWith("https://rim.example.org/api");
    expect(screen.queryByRole("button", { name: "Use this server" })).not.toBeInTheDocument();
    expect(switchServer).not.toHaveBeenCalled();
  });

  it("shows the server's version, then moves to it once accepted", async () => {
    fetchServerInfoAt.mockResolvedValue(
      fakeServerInfo({}, { version: "0.0.1", instanceNotice: "Welcome to Example." }),
    );
    const user = await openWith("https://rim.example.org");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "rim.example.org runs RIM 0.0.1, API 1.Welcome to Example.",
    );
    expect(switchServer).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use this server" }));
    expect(switchServer).toHaveBeenCalledWith("https://rim.example.org/api");
  });

  it("warns when the server speaks a newer API than this app", async () => {
    fetchServerInfoAt.mockResolvedValue(fakeServerInfo({}, { apiVersion: 99 }));
    await openWith("rim.example.org");
    expect(await screen.findByRole("status")).toHaveTextContent(NEWER_SERVER_API_MESSAGE);
  });

  it("checks again after the address changes", async () => {
    fetchServerInfoAt.mockResolvedValue(fakeServerInfo());
    const user = await openWith("rim.example.org");
    await screen.findByRole("button", { name: "Use this server" });

    await user.type(screen.getByRole("textbox", { name: /Server address/ }), "x");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check server" })).toBeInTheDocument();
  });

  it("closes the field on cancel", async () => {
    const user = await openWith("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Use another server" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another server" })).toBeInTheDocument();
  });

  it("goes back to the default server after a move", async () => {
    moved.value = true;
    const user = userEvent.setup();
    render(<ServerChoice />);
    await user.click(screen.getByRole("button", { name: "Back to the default server" }));
    expect(switchServer).toHaveBeenCalledWith(null);
  });
});
