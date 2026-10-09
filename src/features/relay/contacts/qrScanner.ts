/** The browser's QR code reader (`BarcodeDetector`) and the camera, where both exist. */

interface DetectedCode {
  rawValue: string;
}

interface QrDetector {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

type QrDetectorClass = new (options: { formats: string[] }) => QrDetector;

/** The browser's QR code reader, where it has one. */
export function detectorClass(): QrDetectorClass | null {
  const candidate = (globalThis as { BarcodeDetector?: QrDetectorClass }).BarcodeDetector;
  return candidate && typeof navigator.mediaDevices?.getUserMedia === "function" ? candidate : null;
}

/** Whether this app can read a contact's QR code with the camera. */
export function canScanCodes(): boolean {
  return detectorClass() !== null;
}
