/** A device link fingerprint, `XXXX-XXXX`, large enough to compare across two screens. */
export function Fingerprint({ value }: { value: string }) {
  return (
    <p aria-label="Fingerprint" className="font-mono text-2xl tracking-widest text-rim-text">
      {value}
    </p>
  );
}
