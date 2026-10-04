import { useEffect, useRef, useCallback } from "react";

export function usePluginFocusManager(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  onEscapeToHost: () => void,
) {
  const hostActiveElementRef = useRef<Element | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Escape from iframe returns focus to host
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeToHost();
        if (hostActiveElementRef.current && "focus" in hostActiveElementRef.current) {
          (hostActiveElementRef.current as HTMLElement).focus();
        }
      }
    },
    [onEscapeToHost],
  );

  // Listen for messages from the iframe requesting focus return
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "rim.focus.return") {
        onEscapeToHost();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [iframeRef, onEscapeToHost]);

  const focusIframe = useCallback(() => {
    hostActiveElementRef.current = document.activeElement;
    iframeRef.current?.focus();
  }, [iframeRef]);

  // Capture keydown on the iframe wrapper for escape handling
  const onWrapperKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      handleKeyDown(event.nativeEvent);
    },
    [handleKeyDown],
  );

  return { focusIframe, onWrapperKeyDown };
}
