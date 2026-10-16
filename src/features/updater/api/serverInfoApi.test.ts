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
});
