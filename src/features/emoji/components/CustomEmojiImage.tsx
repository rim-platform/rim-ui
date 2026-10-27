import { useServerMediaUrl } from "../../../shared/media/serverMedia";
import { cn } from "../../../shared/ui/cn";

/**
 * A custom emoji's image, loaded the way the app loads server files: as given on the web,
 * downloaded with the session on the desktop. Shows an empty box of the same size until it
 * has arrived, and when it fails.
 */
export function CustomEmojiImage({
  url,
  name,
  className,
}: {
  url: string;
  name: string;
  className?: string;
}) {
  const src = useServerMediaUrl(url);
  return src ? (
    <img src={src} alt={name} className={className} />
  ) : (
    <span aria-hidden className={cn(className, "inline-block")} />
  );
}
