// host.commands over both transports: what the SDK sends for rim.command.execute and the
// run status it hands the plugin back, never more.
import { describe, expect, it } from "vitest";

import { definePlugin, ErrorCode } from "../src/index.ts";
import { startTestHost } from "../src/testing.ts";

function runner() {
  return definePlugin({
    id: "dev.example.runner",
    commands: {
      home: {
        async run({ host }) {
          const opened = await host.commands.execute("workspace.open_home");
          const posted = await host.commands.execute("chat.post_message", {
            conversation_id: "c-1",
            text: "hi",
          });
          return { payload: { opened, posted } };
        },
      },
    },
  });
}

describe.each(["stdio", "port"] as const)("host.commands over %s", (transport) => {
  it("sends the id and arguments and returns only the run status", async () => {
    const calls: [string, unknown][] = [];
    const host = startTestHost(runner(), {
      transport,
      onRequest(method, params) {
        calls.push([method, params]);
        return (params as { commandId: string }).commandId === "workspace.open_home"
          ? { status: "success", payload: { secret: "never passed on" } }
          : { status: "refused", code: "NOT_GRANTED", message: "not granted" };
      },
    });
    await host.handshake();
    const answer = await host.execute("home");
    expect(answer.result?.payload).toEqual({
      opened: { status: "success" },
      posted: { status: "refused", code: "NOT_GRANTED", message: "not granted" },
    });
    expect(calls).toEqual([
      ["rim.command.execute", { commandId: "workspace.open_home", args: {} }],
      [
        "rim.command.execute",
        { commandId: "chat.post_message", args: { conversation_id: "c-1", text: "hi" } },
      ],
    ]);
    await host.shutdown();
  });

  it("fails the command when an older host does not know the request", async () => {
    const host = startTestHost(runner(), { transport });
    await host.handshake();
    const answer = await host.execute("home");
    expect(answer.error?.code).toBe(ErrorCode.PLUGIN_ERROR);
    expect(answer.error?.message).toContain("method not found");
    await host.shutdown();
  });

  it("refuses an answer without a run status", async () => {
    const host = startTestHost(runner(), { transport, onRequest: () => ({ ok: true }) });
    await host.handshake();
    const answer = await host.execute("home");
    expect(answer.error?.message).toContain("without a run status");
    await host.shutdown();
  });
});
