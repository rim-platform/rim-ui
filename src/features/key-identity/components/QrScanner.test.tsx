import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { QrScanner } from "./QrScanner";

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

describe("QrScanner", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for the back camera without sound and stops it when closed", async () => {
    const { track, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(<QrScanner onCode={vi.fn()} />);
    expect(screen.getByLabelText("Camera")).toBeInTheDocument();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
      audio: false,
    });

    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops a camera that only starts after the scanner closed", async () => {
    const { track, stream } = fakeStream();
    let grant!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => (grant = resolve)));
    const { unmount } = render(<QrScanner onCode={vi.fn()} />);
    unmount();
    await act(async () => grant(stream));
    expect(track.stop).toHaveBeenCalled();
  });

  it("says to paste the code when the camera is refused", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<QrScanner onCode={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/paste the code instead/i);
  });
});
