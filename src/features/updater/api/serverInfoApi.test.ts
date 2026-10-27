import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { fetchServerInfoAt } from "./serverInfoApi";

describe("fetchServerInfoAt", () => {
  it("reads the server info of the endpoint it is given", async () => {
    const urls: string[] = [];
    server.use(
      http.post("https://rim.example.org/api", ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          data: { serverInfo: { version: "0.0.1", apiVersion: 1, features: null } },
        });
      }),
    );

    await expect(fetchServerInfoAt("https://rim.example.org/api")).resolves.toEqual({
      version: "0.0.1",
      apiVersion: 1,
      features: [],
    });
    expect(urls).toEqual(["https://rim.example.org/api"]);
  });

  it("reads capabilities, and falls back to the query without them for an older server", async () => {
    const operations: string[] = [];
    let older = false;
    server.use(
      http.post("https://rim.example.org/api", async ({ request }) => {
        const { query } = (await request.json()) as { query: string };
        const operation = /query (\w+)/.exec(query)?.[1] ?? "";
        operations.push(operation);
        if (query.includes("capabilities") && older) {
          return HttpResponse.json({
            errors: [{ message: 'Unknown field "capabilities" on type "ServerInfo"' }],
          });
        }
        return HttpResponse.json({
          data: {
            serverInfo: {
              version: "0.0.5",
              apiVersion: 1,
              features: [],
              ...(query.includes("capabilities") ? { capabilities: ["message_edited_at"] } : {}),
            },
          },
        });
      }),
    );

    await expect(fetchServerInfoAt("https://rim.example.org/api")).resolves.toMatchObject({
      capabilities: ["message_edited_at"],
    });
    expect(operations).toEqual(["ServerInfo"]);

    older = true;
    operations.length = 0;
    const info = await fetchServerInfoAt("https://rim.example.org/api");
    expect(info.capabilities).toBeUndefined();
    expect(operations).toEqual(["ServerInfo", "ServerInfoWithAccount"]);
  });
});
