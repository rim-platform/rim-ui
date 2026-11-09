import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { HELLO_WEB_MANIFEST } from "../../web/testing/helloWeb";
import { planUpdate } from "../model";
import type { UpdatePrompt } from "../state";
import { installedHello, verified } from "../testing/fixtures";
import { UpdatePromptDialog } from "./UpdatePromptDialog";

describe("UpdatePromptDialog", () => {
  it("lists the new commands an update asks to run", () => {
    const check = verified({
      manifest: HELLO_WEB_MANIFEST.replace(
        '"entrypoint"',
        '"runs_commands":["workspace.open_home","chat.post_message"],"entrypoint"',
      ),
    });
    const plugin = installedHello();
    const prompt: UpdatePrompt = {
      plugin,
      check,
      plan: planUpdate(plugin, check),
      workspaceName: "Acme",
    };
    render(<UpdatePromptDialog prompt={prompt} onReview={() => {}} onLater={() => {}} />);
    expect(
      screen.getByText("New commands it can run: workspace.open_home, chat.post_message"),
    ).toBeInTheDocument();
    expect(screen.queryByText("It runs steps after installing.")).toBeNull();
  });
});
