import { Z } from "../ui/zIndex";
import { useToastStore } from "./useToastStore";
import { ToastItem } from "./ToastItem";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-20 flex flex-col gap-2" style={{ zIndex: Z.TOAST }}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
