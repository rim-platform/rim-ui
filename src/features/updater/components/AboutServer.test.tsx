import { afterEach, describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { renderWithProviders } from "../../../test/utils";
import { CLIENT_API_VERSION } from "../api/serverInfoApi";
import { NEWER_SERVER_API_MESSAGE } from "../hooks/useServerInfo";
import { AboutServerApiBanner, AboutServerFeatures, AboutServerVersion } from "./AboutServer";
import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { withServerInfo } from "../../../test/serverInfo";
import powVectors from "../../../../protocol/pow-vectors.json";
import relayVectors from "../../../../protocol/relay-vectors.json";
import { resetServerOrigin } from "../../relay/state/serverOrigin";

afterEach(() => resetServerOrigin());

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
  it("shows the server's host, version and API version, and no banner when the API matches", async () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    renderWithProviders(<About />);

    expect(
      await screen.findByText(`Server localhost:8080, version 0.3.0, API ${CLIENT_API_VERSION}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("names the server by the host its discovery document declares", async () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    server.use(
      http.get("*/.well-known/rim-server", () =>
        HttpResponse.text(
          JSON.stringify({
            rim: "server-discovery",
            keyLog: [relayVectors.relay.inception],
            descriptor: powVectors.powDescriptor,
          }),
        ),
      ),
    );
    renderWithProviders(<About />);

    expect(
      await screen.findByText(`Server relay.example, version 0.3.0, API ${CLIENT_API_VERSION}`),
    ).toBeInTheDocument();
  });

  it("shows nothing while the server's version loads", () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    const { container } = renderWithProviders(<About />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says the server is unreachable when the query fails", async () => {
    server.use(http.post("*/api", () => HttpResponse.error()));
    renderWithProviders(<About />);

    expect(await screen.findByText("Server localhost:8080 unreachable")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a banner when the server speaks a newer API", async () => {
    serveInfo("2.0.0", CLIENT_API_VERSION + 1);
    renderWithProviders(<About />);

    expect(
      await screen.findByText(
        `Server localhost:8080, version 2.0.0, API ${CLIENT_API_VERSION + 1}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(NEWER_SERVER_API_MESSAGE);
  });

  it("shows no banner when the server speaks an older API", async () => {
    serveInfo("0.0.1", CLIENT_API_VERSION - 1);
    renderWithProviders(<About />);

    expect(
      await screen.findByText(
        `Server localhost:8080, version 0.0.1, API ${CLIENT_API_VERSION - 1}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("AboutServerFeatures", () => {
  it("lists every known feature with its state, and the reason of an unavailable one", () => {
    render(<AboutServerFeatures />, {
      wrapper: withServerInfo({
        attachments: ServerFeatureState.DISABLED,
        email: { state: ServerFeatureState.UNAVAILABLE, reason: "SMTP is not configured" },
      }),
    });

    const list = screen.getByRole("list", { name: "Server features" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "AttachmentsSwitched off",
      "Link previewsOn",
      "EmailNot set upSMTP is not configured",
      "Custom emojiOn",
      "Workspace pluginsOn",
      "AI commandsOn",
      "Profile picturesOn",
    ]);
  });

  it("leaves out a feature this client does not know", async () => {
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: {
          version: "0.5.0",
          apiVersion: CLIENT_API_VERSION,
          features: [
            { key: "attachments", state: "ENABLED", reason: null },
            { key: "teleport", state: "DISABLED", reason: null },
          ],
        },
      }),
    );
    renderWithProviders(<AboutServerFeatures />);

    const list = await screen.findByRole("list", { name: "Server features" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("teleport")).not.toBeInTheDocument();
  });

  it("shows nothing for a server that lists no features", async () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    renderWithProviders(
      <>
        <AboutServerVersion />
        <AboutServerFeatures />
      </>,
    );
    expect(
      await screen.findByText(`Server localhost:8080, version 0.3.0, API ${CLIENT_API_VERSION}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Server features" })).not.toBeInTheDocument();
  });
});
