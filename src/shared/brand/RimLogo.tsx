/** Path data of the RIM wordmark on its 100-unit grid, two pieces per letter. */
const R_PATHS = [
  "M12 10 H31 V43.22 L40.94 51 L31 58.78 V90 H12 Z",
  "M36 10 H58 A25 25 0 0 1 69.7 57.1 L90 90 H69 L50 60 H37.57 L49.06 51 L37.57 42 H57 A7 7 0 0 0 57 28 H36 Z",
];
const I_PATHS = [
  "M102 10 H121 V34.82 L111.5 46.95 L102 34.82 Z",
  "M102 42.92 L111.5 55.05 L121 42.92 V90 H102 Z",
];
const M_PATHS = [
  "M133 10 H154 L173.5 47.2 V88.2 L152 47.1 V90 H133 Z",
  "M219 10 H198 L178.5 47.2 V88.2 L200 47.1 V90 H219 Z",
];

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

/** Each path string as a `<path>` element. */
function Paths({ paths }: { paths: string[] }) {
  return paths.map((d) => <path key={d} d={d} />);
}

/** The R alone, filled with the current text colour. */
export function RimMark({ className, label }: BrandGraphicProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      {...a11yProps(label)}
    >
      <Paths paths={R_PATHS} />
    </svg>
  );
}

/** The RIM wordmark, filled with the current text colour. */
export function RimLockup({ className, label }: BrandGraphicProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 231 100"
      fill="currentColor"
      className={className}
      {...a11yProps(label)}
    >
      <Paths paths={[...R_PATHS, ...I_PATHS, ...M_PATHS]} />
    </svg>
  );
}

/** One splash circle with its letter knocked out in the page background colour. */
function SplashBall({
  cx,
  fillClass,
  translateX,
  paths,
  delay,
}: {
  cx: number;
  fillClass: string;
  translateX: number;
  paths: string[];
  delay: string;
}) {
  return (
    <g className="rim-splash-ball" style={{ animationDelay: delay }}>
      <circle cx={cx} cy="50" r="46" className={fillClass} />
      <g className="fill-rim-void" transform={`translate(${translateX} 22.5) scale(0.55)`}>
        <Paths paths={paths} />
      </g>
    </g>
  );
}

/**
 * R, I and M in circles bouncing like a typing indicator, for loading screens only. The R and I
 * circles take the current text colour, the M circle the signal accent; reduced motion holds
 * the circles still.
 */
export function RimSplash({ className, label }: BrandGraphicProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -12 304 112"
      className={className}
      {...a11yProps(label)}
    >
      <SplashBall cx={50} fillClass="fill-current" translateX={24.15} paths={R_PATHS} delay="0s" />
      <SplashBall
        cx={152}
        fillClass="fill-current"
        translateX={90.675}
        paths={I_PATHS}
        delay="0.15s"
      />
      <SplashBall
        cx={254}
        fillClass="fill-rim-signal"
        translateX={157.2}
        paths={M_PATHS}
        delay="0.3s"
      />
    </svg>
  );
}
