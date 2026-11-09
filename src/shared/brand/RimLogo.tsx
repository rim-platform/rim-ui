import { useId } from "react";

/** The R's stem, on the mark's 100-unit grid. */
const R_STEM = { x: 12, y: 8, width: 20, height: 84, rx: 4 };
/** The R's bowl: the outer shape with its counter cut out (even-odd fill). */
const R_BOWL = "M40 8 H60 A24 24 0 0 1 60 56 H40 Z M40 25 V39 H58.5 A7 7 0 0 0 58.5 25 Z";
/** The R's leg. */
const R_LEG = "M54 64 H75 L92 92 H71 Z";
/** The orange node sitting in the gap between the R's pieces. */
const R_NODE = { cx: 43, cy: 68, r: 6 };
/** The M of the wordmark, on its 214 x 80 grid. */
const M_PATH = "M140 72 V8 H158 L175 40 L192 8 H210 V72 H194 V36 L180 62 H170 L156 36 V72 Z";
/** The lightning bolt that is the I of the wordmark, on its 214 x 80 grid. */
const BOLT_PATH = "M115 8 L84 44 H100 L91 72 L122 36 H106 Z";
/** Places the 100-unit R on the wordmark's grid. */
const R_IN_WORDMARK = "translate(-3.144 1.904) scale(.762)";

interface BrandGraphicProps {
  className?: string;
  /** Accessible name; without one the graphic is decorative and hidden from assistive tech. */
  label?: string;
}

/** Image role and name when labelled, hidden from assistive tech otherwise. */
function a11yProps(label: string | undefined) {
  return label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const, focusable: "false" as const };
}

/** The R in three separate pieces plus its signal-coloured node. */
function RLetter() {
  return (
    <>
      <rect {...R_STEM} />
      <path fillRule="evenodd" d={R_BOWL} />
      <path d={R_LEG} />
      <circle {...R_NODE} className="fill-rim-signal" />
    </>
  );
}

/** The wordmark's R and M, without the bolt. */
function WordmarkLetters() {
  return (
    <>
      <g transform={R_IN_WORDMARK}>
        <RLetter />
      </g>
      <path d={M_PATH} />
    </>
  );
}

/** The R alone, filled with the current text colour; its node is the signal colour. */
export function RimMark({ className, label }: BrandGraphicProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      {...a11yProps(label)}
    >
      <RLetter />
    </svg>
  );
}

/** The RIM wordmark: letters in the current text colour, the bolt in the signal colour. */
export function RimLockup({ className, label }: BrandGraphicProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 214 80"
      fill="currentColor"
      className={className}
      {...a11yProps(label)}
    >
      <WordmarkLetters />
      <path d={BOLT_PATH} className="fill-rim-signal" />
    </svg>
  );
}

/**
 * The wordmark with a glow behind the bolt that pulses, for loading screens only; reduced
 * motion holds a still, softly lit glow.
 */
export function RimSplash({ className, label }: BrandGraphicProps) {
  const base = "rim-glow-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const wide = `${base}-wide`;
  const halo = `${base}-halo`;
  const core = `${base}-core`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-8 -28 230 136"
      fill="currentColor"
      className={className}
      {...a11yProps(label)}
    >
      <defs>
        <filter id={wide} filterUnits="userSpaceOnUse" x="20" y="-60" width="170" height="200">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id={halo} filterUnits="userSpaceOnUse" x="40" y="-40" width="130" height="160">
          <feGaussianBlur stdDeviation="11" />
        </filter>
        <filter id={core} filterUnits="userSpaceOnUse" x="60" y="-20" width="90" height="120">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>
      <WordmarkLetters />
      <path d={BOLT_PATH} className="rim-glow-wide fill-rim-signal" filter={`url(#${wide})`} />
      <path d={BOLT_PATH} className="rim-glow-halo fill-rim-signal" filter={`url(#${halo})`} />
      <path d={BOLT_PATH} className="rim-glow-core" filter={`url(#${core})`} />
      <path d={BOLT_PATH} className="rim-glow-bolt fill-rim-signal" />
    </svg>
  );
}
