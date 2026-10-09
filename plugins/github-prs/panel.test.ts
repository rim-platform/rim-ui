// @vitest-environment jsdom
// The Pull requests panel page in a DOM: it renders the state the plugin
// publishes as text and asks the host to run the plugin's commands.
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PanelState } from "./plugin.ts";

const dir = `${import.meta.dirname}/panels/prs`;
const html = readFileSync(`${dir}/index.html`, "utf8");
const script = readFileSync(`${dir}/app.js`, "utf8");

const STATE: PanelState = {
  repos: [
    {
      repo: "rust-lang/rust",
      error: null,
      pulls: [
        {
          number: 7,
          title: "<img src=x onerror=alert(1)>",
          url: "https://github.com/rust-lang/rust/pull/7",
          author: "ada",
          avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
          createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          draft: true,
        },
      ],
    },
    { repo: "acme/private", error: "acme/private was not found, or it is private.", pulls: [] },
  ],
  maxRepos: 10,
  fetchedAt: new Date().toISOString(),
  loading: false,
  notice: null,
  signedIn: true,
};

let sent: Array<Record<string, unknown>>;
let added: Array<() => void>;

function fromHost(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, source: window }));
}

beforeEach(() => {
  sent = [];
  added = [];
  for (const target of [window, document] as EventTarget[]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      added.push(() => target.removeEventListener(type, listener, options));
    });
  }
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    sent.push(message as Record<string, unknown>);
  });
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html")
    .documentElement.innerHTML.replace(/<script[^>]*><\/script>/, "");
  new Function(script)();
});

afterEach(() => {
  for (const remove of added) remove();
  vi.restoreAllMocks();
});

describe("Pull requests panel", () => {
  it("renders the repositories and pull requests it is sent, as text, with no links", () => {
    fromHost({ type: "panel.state_update", state: STATE });
    const sections = [...document.querySelectorAll("section")];
    expect(sections.map((s) => s.querySelector(".name")?.textContent)).toEqual([
      "rust-lang/rust",
      "acme/private",
    ]);
    const title = sections[0].querySelector(".title");
    expect(title?.textContent).toBe("#7 <img src=x onerror=alert(1)>draft");
    expect(sections[0].querySelector(".meta")?.textContent).toBe("ada · 2h");
    expect(sections[0].querySelectorAll("img")).toHaveLength(1);
    expect(sections[1].querySelector(".error")?.textContent).toBe(
      "acme/private was not found, or it is private.",
    );
    expect(document.querySelector("a")).toBeNull();
  });

  it("ignores messages that do not come from the host", () => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "panel.state_update", state: STATE } }),
    );
    expect(document.querySelectorAll("section")).toHaveLength(0);
  });

  it("adds, removes and refreshes through the plugin's commands", () => {
    fromHost({ type: "panel.state_update", state: STATE });
    const input = document.getElementById("repo") as HTMLInputElement;
    input.value = " tokio-rs/tokio ";
    document.getElementById("add")?.click();
    (document.querySelector("section h2 button") as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(sent.map((m) => [m.commandId, m.args])).toEqual([
      ["plugin.chat.rim.github-prs.add_repo", { repo: "tokio-rs/tokio" }],
      ["plugin.chat.rim.github-prs.remove_repo", { repo: "rust-lang/rust" }],
      ["plugin.chat.rim.github-prs.refresh", {}],
    ]);
    fromHost({ type: "rim.command.result", requestId: "prs-1", ok: false, message: "No room." });
    expect(document.getElementById("notice")?.textContent).toBe("No room.");
    expect(input.value).toBe(" tokio-rs/tokio ");
  });

  it("shows GitHub's refusal and turns the form off when the list is full or nobody is signed in", () => {
    fromHost({
      type: "panel.state_update",
      state: { ...STATE, notice: "GitHub refused: try again after 13:00.", maxRepos: 2 },
    });
    expect(document.getElementById("notice")?.hidden).toBe(false);
    expect(document.getElementById("notice")?.textContent).toBe(
      "GitHub refused: try again after 13:00.",
    );
    expect((document.getElementById("add") as HTMLButtonElement).disabled).toBe(true);
    fromHost({ type: "panel.state_update", state: { ...STATE, repos: [], signedIn: false } });
    expect(document.getElementById("empty")?.textContent).toBe(
      "Sign in to keep a list of repositories.",
    );
  });

  it("says the plugin stopped once its state goes away", () => {
    fromHost({ type: "panel.state_update", state: STATE });
    fromHost({ type: "panel.state_update", state: null });
    expect(document.querySelectorAll("section")).toHaveLength(0);
    expect(document.getElementById("empty")?.textContent).toBe("The plugin stopped.");
  });
});
