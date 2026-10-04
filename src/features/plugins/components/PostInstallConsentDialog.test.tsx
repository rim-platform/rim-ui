import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PostInstallConsentDialog } from "./PostInstallConsentDialog";
import type { PostInstallConsentRequest } from "../types";

const request: PostInstallConsentRequest = {
  plugin_id: "dev.example.weather",
  steps: [
    {
      program: "npm",
      args: ["install", "--production"],
      working_dir: "/home/u/.rim/plugins/dev.example.weather",
      trigger_file: "package.json",
      command_line: "npm install --production",
    },
    {
      program: "pip",
      args: ["install", "-r", "requirements.txt", "--user"],
      working_dir: "/home/u/.rim/plugins/dev.example.weather",
      trigger_file: "requirements.txt",
      command_line: "pip install -r requirements.txt --user",
    },
  ],
};

describe("PostInstallConsentDialog", () => {
  it("names every command verbatim with its directory and warns about privileges", () => {
    render(
      <PostInstallConsentDialog
        request={request}
        isPending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Run plugin install scripts?" })).toBeInTheDocument();
    expect(screen.getByText("npm install --production")).toBeInTheDocument();
    expect(screen.getByText("pip install -r requirements.txt --user")).toBeInTheDocument();
    expect(screen.getAllByText("/home/u/.rim/plugins/dev.example.weather")).toHaveLength(2);
    expect(screen.getByText("dev.example.weather")).toBeInTheDocument();
    expect(
      screen.getByText(/executes code from the plugin author with your user's privileges/i),
    ).toBeInTheDocument();
  });

  it("calls onConfirm only from the explicit confirm button", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PostInstallConsentDialog
        request={request}
        isPending={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run commands and install" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables confirm while the consented install is running", () => {
    render(
      <PostInstallConsentDialog
        request={request}
        isPending
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /run commands and install/i })).toBeDisabled();
  });
});
