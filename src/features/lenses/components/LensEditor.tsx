import { useState, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { cn } from "../../../shared/ui/cn";
import { useCreateLensMutation, useUpdateLensMutation } from "../api/useLenses";
import type { ChannelLens, FilterCondition, FilterField, FilterLogic, FilterOp } from "../api/useLenses";
import { FilterField as FF, FilterOp as FO, FilterLogic as FL } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";

interface LensEditorProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  conversationId: string;
  existingLens?: ChannelLens | null;
}

const FIELD_OPTIONS: { value: FilterField; label: string }[] = [
  { value: FF.HAS_LINKS, label: "Has Links" },
  { value: FF.HAS_ATTACHMENTS, label: "Has Attachments" },
  { value: FF.IS_PINNED, label: "Is Pinned" },
  { value: FF.AUTHOR_ID, label: "Author" },
  { value: FF.TEXT_CONTAINS, label: "Text Contains" },
];

const BOOLEAN_FIELDS: FilterField[] = [FF.HAS_LINKS, FF.HAS_ATTACHMENTS, FF.IS_PINNED];

function getDefaultOp(field: FilterField): FilterOp {
  if (BOOLEAN_FIELDS.includes(field)) return FO.EQ;
  if (field === FF.AUTHOR_ID) return FO.IN;
  return FO.CONTAINS;
}

function getDefaultValue(field: FilterField): unknown {
  if (BOOLEAN_FIELDS.includes(field)) return true;
  if (field === FF.AUTHOR_ID) return [];
  return "";
}

function makeEmptyCondition(): FilterCondition {
  return { field: FF.HAS_LINKS, op: FO.EQ, value: true };
}

const MAX_CONDITIONS = 20;

export function LensEditor({ open, onClose, serverId, conversationId, existingLens }: LensEditorProps) {
  const isEditing = Boolean(existingLens);

  const [name, setName] = useState(existingLens?.name ?? "");
  const [logic, setLogic] = useState<FilterLogic>(existingLens?.filterSpec.logic ?? FL.AND);
  const [conditions, setConditions] = useState<FilterCondition[]>(
    existingLens?.filterSpec.conditions.length
      ? existingLens.filterSpec.conditions
      : [makeEmptyCondition()],
  );
  const [isShared, setIsShared] = useState(existingLens?.isShared ?? false);

  const createLens = useCreateLensMutation();
  const updateLens = useUpdateLensMutation();

  const isSaving = createLens.isPending || updateLens.isPending;

  const handleFieldChange = useCallback((index: number, field: FilterField) => {
    setConditions((prev) =>
      prev.map((c, i) =>
        i === index ? { field, op: getDefaultOp(field), value: getDefaultValue(field) } : c,
      ),
    );
  }, []);

  const handleValueChange = useCallback((index: number, value: unknown) => {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, value } : c)),
    );
  }, []);

  const addCondition = useCallback(() => {
    if (conditions.length >= MAX_CONDITIONS) return;
    setConditions((prev) => [...prev, makeEmptyCondition()]);
  }, [conditions.length]);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Lens name is required");
      return;
    }
    if (conditions.length === 0) {
      toast.error("At least one condition is required");
      return;
    }

    const filterSpec = { conditions, logic };

    try {
      if (isEditing && existingLens) {
        await updateLens.mutateAsync({
          lensId: existingLens.id,
          serverId,
          conversationId,
          name: trimmedName,
          filterSpec,
          isShared,
        });
        toast.success("Lens updated");
      } else {
        await createLens.mutateAsync({
          serverId,
          conversationId,
          name: trimmedName,
          filterSpec,
          isShared,
        });
        toast.success("Lens created");
      }
      onClose();
    } catch {
      toast.error(isEditing ? "Failed to update lens" : "Failed to create lens");
    }
  }, [name, conditions, logic, isShared, isEditing, existingLens, serverId, conversationId, createLens, updateLens, onClose]);

  return (
    <Dialog open={open} onClose={onClose} title={isEditing ? "Edit Lens" : "Create Lens"} maxWidth="max-w-md">
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-rim-text-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 100))}
            placeholder="e.g. Messages with links"
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
          />
        </div>

        {/* Logic toggle */}
        <div>
          <label className="mb-1 block text-xs font-medium text-rim-text-muted">Match</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setLogic(FL.AND)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition",
                logic === "AND"
                  ? "bg-rim-accent/10 text-rim-accent"
                  : "text-rim-text-muted hover:bg-white/5",
              )}
            >
              All conditions (AND)
            </button>
            <button
              type="button"
              onClick={() => setLogic(FL.OR)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition",
                logic === "OR"
                  ? "bg-rim-accent/10 text-rim-accent"
                  : "text-rim-text-muted hover:bg-white/5",
              )}
            >
              Any condition (OR)
            </button>
          </div>
        </div>

        {/* Conditions */}
        <div>
          <label className="mb-1 block text-xs font-medium text-rim-text-muted">Conditions</label>
          <div className="space-y-2">
            {conditions.map((cond, index) => (
              <ConditionRow
                key={index}
                condition={cond}
                onFieldChange={(field) => handleFieldChange(index, field)}
                onValueChange={(value) => handleValueChange(index, value)}
                onRemove={() => removeCondition(index)}
                canRemove={conditions.length > 1}
              />
            ))}
          </div>
          {conditions.length < MAX_CONDITIONS && (
            <button
              type="button"
              onClick={addCondition}
              className="mt-2 flex items-center gap-1 text-xs text-rim-accent transition hover:text-rim-text"
            >
              <Plus className="h-3 w-3" />
              Add condition
            </button>
          )}
        </div>

        {/* Shared checkbox */}
        <label className="flex items-center gap-2 text-xs text-rim-text-muted">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(e) => setIsShared(e.target.checked)}
            className="rounded border-rim-line"
          />
          Share with channel members
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition",
              isSaving
                ? "bg-rim-accent/20 text-rim-accent/50"
                : "bg-rim-accent/10 text-rim-accent hover:bg-rim-accent/20",
            )}
          >
            {isSaving ? "Saving..." : isEditing ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// --- ConditionRow ---

interface ConditionRowProps {
  condition: FilterCondition;
  onFieldChange: (field: FilterField) => void;
  onValueChange: (value: unknown) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ConditionRow({ condition, onFieldChange, onValueChange, onRemove, canRemove }: ConditionRowProps) {
  const isBooleanField = BOOLEAN_FIELDS.includes(condition.field);

  return (
    <div className="flex items-center gap-2">
      {/* Field selector */}
      <select
        value={condition.field}
        onChange={(e) => onFieldChange(e.target.value as FilterField)}
        className="rounded-lg border border-rim-line bg-rim-void px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
      >
        {FIELD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Value input */}
      {isBooleanField ? (
        <select
          value={condition.value === true ? "true" : "false"}
          onChange={(e) => onValueChange(e.target.value === "true")}
          className="rounded-lg border border-rim-line bg-rim-void px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : condition.field === "AUTHOR_ID" ? (
        <input
          type="text"
          value={Array.isArray(condition.value) ? (condition.value as string[]).join(", ") : String(condition.value ?? "")}
          onChange={(e) =>
            onValueChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="User IDs (comma-separated)"
          className="min-w-0 flex-1 rounded-lg border border-rim-line bg-rim-void px-2 py-1 text-xs text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
        />
      ) : (
        <input
          type="text"
          value={String(condition.value ?? "")}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="Search text..."
          className="min-w-0 flex-1 rounded-lg border border-rim-line bg-rim-void px-2 py-1 text-xs text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
        />
      )}

      {/* Remove */}
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove condition"
          className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-danger"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
