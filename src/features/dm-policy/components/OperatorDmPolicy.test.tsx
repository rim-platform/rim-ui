import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import { DmInbound, DmOutbound } from "../../../core/graphql/generated/schema-types";
import { renderWithServerInfo } from "../../../test/serverInfo";
import { OperatorDmPolicy } from "./OperatorDmPolicy";

describe("OperatorDmPolicy", () => {
  it("shows the operator's DM settings and partner servers", () => {
    renderWithServerInfo(<OperatorDmPolicy />, {
      dmInbound: DmInbound.PARTNERS,
      dmOutbound: DmOutbound.NONE,
      dmPartners: ["rims1_partner"],
    });
    expect(screen.getByText(/^Partners only\. Only people here/)).toBeInTheDocument();
    expect(screen.getByText(/^Not allowed\./)).toBeInTheDocument();
    expect(screen.getByText("rims1_partner")).toBeInTheDocument();
  });

  it("shows nothing for a server that reports no DM settings", () => {
    const { container } = renderWithServerInfo(<OperatorDmPolicy />);
    expect(container).toBeEmptyDOMElement();
  });
});
