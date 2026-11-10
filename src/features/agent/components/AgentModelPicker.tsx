import { useRef, useState } from "react";
import { ChevronDown, Settings } from "lucide-react";

import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { Z } from "../../../shared/ui/zIndex";
import { cn } from "../../../shared/ui/cn";
import { availableModels, type ProviderModels } from "../providers/availableModels";
import type { AiModelDef } from "../providers/types";
import { useAgentStore } from "../state/useAgentStore";
import { useLiveModelsStore } from "../state/useLiveModelsStore";

interface AgentModelPickerProps {
  /** The current model's name. */
  label: string;
  /** Whether switching is refused, as it is while a turn runs. */
  disabled: boolean;
  /** Runs when the person picks a model other than the current one. */
  onPick: (providerId: string, model: AiModelDef) => void;
  /** Runs on "Model settings…". */
  onOpenSettings: () => void;
}

interface OpenMenu {
  position: { x: number; y: number };
  groups: ProviderModels[];
}

/**
 * The agent panel's model switch: a button naming the current model that opens the models of
 * every set-up provider, grouped by provider with the current one checked, and "Model settings…"
 * last.
 */
export function AgentModelPicker({
  label,
  disabled,
  onPick,
  onOpenSettings,
}: AgentModelPickerProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const opening = useRef(false);
  const settings = useAgentStore((s) => s.settings);

  async function toggle() {
    if (menu) {
      setMenu(null);
      return;
    }
    if (disabled || opening.current) return;
    opening.current = true;
    try {
      const groups = await availableModels(useLiveModelsStore.getState().byProvider);
      const rect = anchorRef.current?.getBoundingClientRect();
      setMenu({ position: { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 }, groups });
    } finally {
      opening.current = false;
    }
  }

  const items: DropdownMenuItem[] = [];
  for (const group of menu?.groups ?? []) {
    group.models.forEach((model, index) => {
      const current = group.providerId === settings.providerId && model.id === settings.modelId;
      items.push({
        id: `${group.providerId}/${model.id}`,
        label: model.name,
        checked: current,
        sectionBefore: index === 0 ? group.providerName : undefined,
        onSelect: () => {
          if (!current) onPick(group.providerId, model);
        },
      });
    });
  }
  items.push({
    id: "model-settings",
    label: "Model settings…",
    icon: <Settings className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />,
    separatorBefore: true,
    onSelect: onOpenSettings,
  });

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => void toggle()}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title={disabled ? "The model can be switched once the answer is done" : "Switch model"}
        aria-label={`Model: ${label}`}
        className={cn(
          "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-rim-text-muted transition",
          disabled ? "opacity-50" : "hover:bg-rim-panel-soft hover:text-rim-text",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
      </button>
      {menu && !disabled && (
        <DropdownMenu
          label="Models"
          position={menu.position}
          anchorRef={anchorRef}
          onClose={() => setMenu(null)}
          items={items}
          closeOnSelect
          scroll
          zIndex={Z.POPOVER}
          header={
            menu.groups.length === 0 ? (
              <p className="px-3 py-2 text-xs text-rim-text-muted">
                No provider has an API key set.
              </p>
            ) : undefined
          }
        />
      )}
    </>
  );
}
