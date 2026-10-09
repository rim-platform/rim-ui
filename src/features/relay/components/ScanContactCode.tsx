import { useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { detectorClass } from "../contacts/qrScanner";

const SCAN_INTERVAL_MS = 300;

/**
 * Read a contact QR code with the camera: the first code seen is handed to `onCode`. Only
 * where the browser can read QR codes; elsewhere the link is pasted as text.
 */
export function ScanContactCode({
  onCode,
  onClose,
}: {
  onCode: (text: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        if (!video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        timer = setInterval(() => {
          if (!video.current) return;
          void detector.detect(video.current).then((codes) => {
            const code = codes[0]?.rawValue;
            if (code && !stopped) {
              stopped = true;
              onCode(code);
            }
          });
        }, SCAN_INTERVAL_MS);
      })
      .catch(() => setError("The camera is not available. Paste the contact link instead."));
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="space-y-2">
      <video ref={video} className="w-full max-w-xs rounded-md bg-rim-void" muted playsInline />
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
      <Button variant="secondary" size="sm" onClick={onClose}>
        Stop scanning
      </Button>
    </div>
  );
}
