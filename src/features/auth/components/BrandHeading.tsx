import { RimLockup } from "../../../shared/brand/RimLogo";

/** The auth pages' top heading: the RIM wordmark, named "RIM" for assistive tech. */
export function BrandHeading() {
  return (
    <h1 className="flex justify-center text-rim-text">
      <RimLockup label="RIM" className="h-10 w-auto" />
    </h1>
  );
}
