import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Z } from "./zIndex";

interface HoverTooltipProps {
  content: ReactNode;
  delay?: number;
  gracePeriod?: number;
  children: ReactElement;
}

export function HoverTooltip({
  content,
  delay = 300,
  gracePeriod = 100,
  children,
}: HoverTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number; flipBelow: boolean }>({
    x: 0,
    y: 0,
    flipBelow: false,
  });

  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  // Clean up timers on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tooltipHeight = 120; // estimated max
    const spaceAbove = rect.top;
    const flipBelow = spaceAbove < tooltipHeight;

    setPosition({
      x: rect.left + rect.width / 2,
      y: flipBelow ? rect.bottom + 6 : rect.top - 6,
      flipBelow,
    });
  }, []);

  const show = useCallback(() => {
    clearTimers();
    showTimerRef.current = setTimeout(() => {
      computePosition();
      setVisible(true);
    }, delay);
  }, [clearTimers, computePosition, delay]);

  const startGrace = useCallback(() => {
    clearTimers();
    graceTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, gracePeriod);
  }, [clearTimers, gracePeriod]);

  const cancelGrace = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const handleTriggerEnter = useCallback(() => {
    cancelGrace();
    show();
  }, [cancelGrace, show]);

  const handleTriggerLeave = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    startGrace();
  }, [startGrace]);

  const handleTooltipEnter = useCallback(() => {
    cancelGrace();
  }, [cancelGrace]);

  const handleTooltipLeave = useCallback(() => {
    startGrace();
  }, [startGrace]);

  const handleFocus = useCallback(() => {
    show();
  }, [show]);

  const handleBlur = useCallback(() => {
    clearTimers();
    setVisible(false);
  }, [clearTimers]);

  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    transform: "translateX(-50%)",
    zIndex: Z.POPOVER,
    ...(position.flipBelow ? { top: position.y } : { bottom: window.innerHeight - position.y }),
  };

  // Extract existing event handlers from the child element
  const childProps = children.props as Record<string, unknown>;
  const existingMouseEnter = childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined;
  const existingMouseLeave = childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined;
  const existingFocus = childProps.onFocus as ((e: React.FocusEvent) => void) | undefined;
  const existingBlur = childProps.onBlur as ((e: React.FocusEvent) => void) | undefined;

  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          triggerRef.current = el;
          // Forward ref if the child has one
          const childRef = (children as { ref?: React.Ref<HTMLElement> }).ref;
          if (typeof childRef === "function") {
            childRef(el);
          } else if (childRef && typeof childRef === "object") {
            (childRef as React.MutableRefObject<HTMLElement | null>).current = el;
          }
        },
        onMouseEnter: (e: React.MouseEvent) => {
          handleTriggerEnter();
          existingMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          handleTriggerLeave();
          existingMouseLeave?.(e);
        },
        onFocus: (e: React.FocusEvent) => {
          handleFocus();
          existingFocus?.(e);
        },
        onBlur: (e: React.FocusEvent) => {
          handleBlur();
          existingBlur?.(e);
        },
        "aria-describedby": visible ? tooltipId : undefined,
      } as Record<string, unknown>)}
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={tooltipStyle}
            onMouseEnter={handleTooltipEnter}
            onMouseLeave={handleTooltipLeave}
            className="bg-rim-panel-soft border border-rim-line rounded-lg shadow-lg px-3 py-2"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
