import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { askToBlock, useBlockPersonStore } from "../blocking/useBlockPersonStore";

const blockPerson = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../blocking/blockPerson", () => ({ blockPerson }));

import { act } from "@testing-library/react";
import { BlockPersonDialog } from "./BlockPersonDialog";

const alice = { principalId: "rimp1_alice", name: "Alice" };

beforeEach(() => {
  blockPerson.mockClear();
  useBlockPersonStore.getState().close();
});

describe("BlockPersonDialog", () => {
  it("asks with the person's name and blocks on confirm", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BlockPersonDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => askToBlock(alice));
    expect(await screen.findByText("Block Alice?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    expect(blockPerson).toHaveBeenCalledWith(expect.anything(), alice);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks nothing on cancel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BlockPersonDialog />);
    act(() => askToBlock(alice));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(blockPerson).not.toHaveBeenCalled();
    expect(useBlockPersonStore.getState().target).toBeNull();
  });
});
