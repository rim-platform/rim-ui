import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

const SCAN_MS = 250;
const MAX_SCAN_WIDTH = 640;

/**
 * Read a link code with the camera: frames go to a canvas, scaled down to at most 640 pixels
 * across, and through jsQR until one holds a `rim-link:` code (the scheme in any case). Nothing
 * leaves the page; the camera stops as soon as the code is read or the scanner closes.
 */
export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(onCode);
  useEffect(() => {
    latest.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const canvas = document.createElement("canvas");

    function stop() {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    }

    function scan() {
      const el = video.current;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!el || !context || el.videoWidth === 0) return;
      // A phone's full-resolution frame through jsQR four times a second would lag.
      const scale = Math.min(1, MAX_SCAN_WIDTH / el.videoWidth);
      canvas.width = Math.round(el.videoWidth * scale);
      canvas.height = Math.round(el.videoHeight * scale);
      context.drawImage(el, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(frame.data, frame.width, frame.height, {
        inversionAttempts: "attemptBoth",
      });
      if (found?.data.trim().slice(0, 9).toLowerCase() === "rim-link:") {
        stop();
        latest.current(found.data);
      }
    }

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot use a camera here. Paste the code instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setError("The camera is not available or was not allowed. Paste the code instead.");
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      if (stopped) return;
      timer = window.setInterval(scan, SCAN_MS);
    })();

    return stop;
  }, []);

  return error ? (
    <p role="alert" className="text-sm text-rim-danger">
      {error}
    </p>
  ) : (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Camera"
      className="aspect-square w-full rounded-md border border-rim-line bg-rim-void object-cover"
    />
  );
}
