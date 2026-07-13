import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
  ariaLabel?: string;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  action?: ToastAction;
  persistent?: boolean;
  duration?: number;
  createdAt: number;
  /** Set to true when dismissing — triggers exit animation. */
  dismissing?: boolean;
}

/** Default auto-dismiss durations per variant (ms). */
const DEFAULT_DURATIONS: Record<ToastVariant, number | null> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: null, // persistent by default
};

const MAX_VISIBLE = 3;

let nextId = 0;

type AddToastInput = Omit<Toast, "id" | "createdAt"> & { id?: string };

interface ToastState {
  toasts: Toast[];
  add: (toast: AddToastInput) => string;
  dismiss: (id: string) => void;
  remove: (id: string) => void;
  dismissAll: () => void;
  /** Update an existing toast by id (for deduplication). */
  update: (id: string, patch: Partial<Pick<Toast, "title" | "description" | "action">>) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  add: (toast) => {
    const id = toast.id ?? `toast-${++nextId}`;
    const existing = get().toasts.find((t) => t.id === id);

    if (existing) {
      // Deduplicate: update existing toast
      get().update(id, {
        title: toast.title,
        description: toast.description,
        action: toast.action,
      });
      return id;
    }

    const newToast: Toast = {
      ...toast,
      id,
      createdAt: Date.now(),
    };

    set((state) => {
      let toasts = [newToast, ...state.toasts];

      // Enforce max visible — dismiss oldest non-error toasts first
      if (toasts.filter((t) => !t.dismissing).length > MAX_VISIBLE) {
        const visible = toasts.filter((t) => !t.dismissing);
        const toDismiss = visible
          .slice()
          .reverse()
          .find((t) => t.variant !== "error");
        if (toDismiss) {
          toasts = toasts.map((t) => (t.id === toDismiss.id ? { ...t, dismissing: true } : t));
        }
      }

      return { toasts };
    });

    return id;
  },

  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, dismissing: true } : t)),
    }));
  },

  remove: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  dismissAll: () => {
    set((state) => ({
      toasts: state.toasts.map((t) => ({ ...t, dismissing: true })),
    }));
  },

  update: (id, patch) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, ...patch, createdAt: Date.now() } : t,
      ),
    }));
  },
}));

// ── Convenience helpers ──────────────────────────────────────

interface ToastOptions {
  id?: string;
  description?: string;
  action?: ToastAction;
  duration?: number;
  persistent?: boolean;
}

function createToast(variant: ToastVariant, title: string, options?: ToastOptions): string {
  const defaultDuration = DEFAULT_DURATIONS[variant];
  const persistent = options?.persistent ?? variant === "error";

  return useToastStore.getState().add({
    id: options?.id,
    variant,
    title,
    description: options?.description,
    action: options?.action,
    duration: persistent ? undefined : (options?.duration ?? defaultDuration ?? undefined),
    persistent,
  });
}

export const toast = {
  success: (title: string, options?: ToastOptions) => createToast("success", title, options),
  error: (title: string, options?: ToastOptions) => createToast("error", title, options),
  warning: (title: string, options?: ToastOptions) => createToast("warning", title, options),
  info: (title: string, options?: ToastOptions) => createToast("info", title, options),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  dismissAll: () => useToastStore.getState().dismissAll(),
};
