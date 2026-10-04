import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore, toast } from "./useToastStore";

describe("useToastStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useToastStore.setState({ toasts: [] });
  });

  it("starts with an empty toast list", () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("adds a toast via the store action", () => {
    const id = useToastStore.getState().add({
      variant: "info",
      title: "Hello",
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Hello");
    expect(toasts[0].variant).toBe("info");
    expect(toasts[0].id).toBe(id);
  });

  it("dismisses a toast by id", () => {
    const id = useToastStore.getState().add({
      variant: "success",
      title: "Done",
    });
    useToastStore.getState().dismiss(id);
    const t = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(t?.dismissing).toBe(true);
  });

  it("removes a toast by id", () => {
    const id = useToastStore.getState().add({
      variant: "warning",
      title: "Watch out",
    });
    useToastStore.getState().remove(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("dismisses all toasts", () => {
    useToastStore.getState().add({ variant: "info", title: "A" });
    useToastStore.getState().add({ variant: "info", title: "B" });
    useToastStore.getState().dismissAll();
    const allDismissing = useToastStore.getState().toasts.every((t) => t.dismissing);
    expect(allDismissing).toBe(true);
  });

  it("deduplicates toasts with the same custom id", () => {
    useToastStore.getState().add({ id: "dup", variant: "info", title: "First" });
    useToastStore.getState().add({ id: "dup", variant: "info", title: "Updated" });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Updated");
  });

  it("updates an existing toast", () => {
    const id = useToastStore.getState().add({ variant: "error", title: "Oops" });
    useToastStore.getState().update(id, { title: "Fixed" });
    expect(useToastStore.getState().toasts[0].title).toBe("Fixed");
  });
});

describe("toast convenience helpers", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("toast.success adds a success toast", () => {
    toast.success("Saved");
    const t = useToastStore.getState().toasts[0];
    expect(t.variant).toBe("success");
    expect(t.title).toBe("Saved");
  });

  it("toast.error adds an error toast that is persistent", () => {
    toast.error("Failed");
    const t = useToastStore.getState().toasts[0];
    expect(t.variant).toBe("error");
    expect(t.persistent).toBe(true);
  });

  it("toast.dismiss marks a toast as dismissing", () => {
    const id = toast.info("Note");
    toast.dismiss(id);
    const t = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(t?.dismissing).toBe(true);
  });

  it("toast.dismissAll dismisses all toasts", () => {
    toast.info("A");
    toast.warning("B");
    toast.dismissAll();
    const allDismissing = useToastStore.getState().toasts.every((t) => t.dismissing);
    expect(allDismissing).toBe(true);
  });

  it("toast.success sets default duration of 3000ms", () => {
    toast.success("Quick");
    const t = useToastStore.getState().toasts[0];
    expect(t.duration).toBe(3000);
    expect(t.persistent).toBeFalsy();
  });

  it("toast.info sets default duration of 4000ms", () => {
    toast.info("Note");
    const t = useToastStore.getState().toasts[0];
    expect(t.duration).toBe(4000);
  });

  it("toast.warning sets default duration of 6000ms", () => {
    toast.warning("Careful");
    const t = useToastStore.getState().toasts[0];
    expect(t.duration).toBe(6000);
  });

  it("toast.error has no duration (persistent)", () => {
    toast.error("Oops");
    const t = useToastStore.getState().toasts[0];
    expect(t.persistent).toBe(true);
    expect(t.duration).toBeUndefined();
  });

  it("custom duration overrides default", () => {
    toast.success("Quick", { duration: 1000 });
    const t = useToastStore.getState().toasts[0];
    expect(t.duration).toBe(1000);
  });

  it("enforces MAX_VISIBLE by dismissing oldest non-error toast", () => {
    toast.info("A");
    toast.info("B");
    toast.info("C");
    // 4th toast should cause the oldest to be dismissed
    toast.info("D");
    const toasts = useToastStore.getState().toasts;
    const dismissing = toasts.filter((t) => t.dismissing);
    expect(dismissing.length).toBeGreaterThanOrEqual(1);
  });

  it("error toasts are not auto-dismissed during MAX_VISIBLE overflow", () => {
    toast.error("Error 1");
    toast.error("Error 2");
    toast.error("Error 3");
    toast.info("Info 1");
    const toasts = useToastStore.getState().toasts;
    const dismissedErrors = toasts.filter((t) => t.variant === "error" && t.dismissing);
    expect(dismissedErrors).toHaveLength(0);
  });
});
