import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { renderWithProviders } from "../../../test/utils";
import { CLIENT_API_VERSION } from "../api/serverInfoApi";
import { NEWER_SERVER_API_MESSAGE } from "../hooks/useServerInfo";
import { AboutServerApiBanner, AboutServerVersion } from "./AboutServer";

function serveInfo(version: string, apiVersion: number) {
  server.use(mockGraphQLQuery("ServerInfo", { serverInfo: { version, apiVersion } }));
}

function About() {
  return (
    <>
      <AboutServerVersion />
      <AboutServerApiBanner />
    </>
  );
}

describe("About server rows", () => {
  it("shows the server's version and no banner when the API matches", async () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    renderWithProviders(<About />);

    expect(await screen.findByText("Server 0.3.0")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows nothing while the server's version loads", () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    const { container } = renderWithProviders(<About />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says the server is unreachable when the query fails", async () => {
    server.use(http.post("*/api", () => HttpResponse.error()));
    renderWithProviders(<About />);

    expect(await screen.findByText("Server unreachable")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a banner when the server speaks a newer API", async () => {
    serveInfo("2.0.0", CLIENT_API_VERSION + 1);
    renderWithProviders(<About />);

    expect(await screen.findByText("Server 2.0.0")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(NEWER_SERVER_API_MESSAGE);
  });

  it("shows no banner when the server speaks an older API", async () => {
    serveInfo("0.0.1", CLIENT_API_VERSION - 1);
    renderWithProviders(<About />);

    expect(await screen.findByText("Server 0.0.1")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
