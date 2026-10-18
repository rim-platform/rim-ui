#!/usr/bin/env node
// Test plugin for the host conformance tests: on start it sets its panel to a
// greeting and a count, and `count` patches the count, so the host's panel
// relay sees both a whole state and a merged one.
import { definePlugin } from "@rim-platform/plugin-sdk";

let count = 0;

await definePlugin({
  id: "dev.example.panel-ts",
  commands: {
    count: {
      async run({ host }) {
        count += 1;
        await host.panels.patch("main", { count });
        return { payload: { count } };
      },
    },
  },
  async onReady(host) {
    await host.panels.set("main", {
      greeting: `Hello, ${host.principal?.displayName ?? "nobody"}!`,
      count,
    });
  },
}).run();
