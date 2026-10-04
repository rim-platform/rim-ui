import { useState, useRef, useCallback } from "react";
import { Upload, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useCustomEmojis } from "../api/useCustomEmojis";
import type { CustomEmoji } from "../api/useCustomEmojis";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { cn } from "../../../shared/ui/cn";

const MAX_FILE_SIZE = 256 * 1024; // 256 KB

const CREATE_CUSTOM_EMOJI_MUTATION = `
  mutation CreateCustomEmoji($input: CreateCustomEmojiInput!) {
    createCustomEmoji(input: $input) {
      id
      serverId
      name
      imageUrl
      uploadedBy
      createdAt
    }
  }
`;

const DELETE_CUSTOM_EMOJI_MUTATION = `
  mutation DeleteCustomEmoji($emojiId: ID!) {
    deleteCustomEmoji(emojiId: $emojiId)
  }
`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface EmojiManagementProps {
  serverId: string | null;
}

/**
 * Custom-emoji management tab. Gating matches the backend's actual permission model
 * (`DefaultCustomEmojiService`), not a single admin flag:
 * - **Upload**: any server member — the backend only checks membership, not role.
 * - **Delete**: the server owner, OR the emoji's own uploader (`emoji.uploadedBy`) —
 *   there is no moderator carve-out. This replaced a hardcoded `isAdmin` prop that
 *   previously gated both actions identically and defaulted to `true`.
 */
export function EmojiManagement({ serverId }: EmojiManagementProps) {
  const { emojis, isLoading } = useCustomEmojis(serverId);
  const { data: me } = useCurrentUser();
  const isOwner = useIsOwner(serverId ?? undefined);

  const canDelete = useCallback(
    (emoji: CustomEmoji) => isOwner || emoji.uploadedBy === me?.id,
    [isOwner, me?.id],
  );
  const [name, setName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const createEmoji = useMutation({
    mutationFn: async ({ emojiName, file }: { emojiName: string; file: File }) => {
      const imageBase64 = await fileToBase64(file);
      return graphqlClient.request<{ createCustomEmoji: CustomEmoji }>(
        CREATE_CUSTOM_EMOJI_MUTATION,
        { input: { serverId, name: emojiName, imageBase64 } },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customEmojis(serverId ?? undefined) });
      resetForm();
    },
    onError: () => {
      setError("Failed to upload emoji. Please try again.");
    },
  });

  const deleteEmoji = useMutation({
    mutationFn: (emojiId: string) =>
      graphqlClient.request(DELETE_CUSTOM_EMOJI_MUTATION, { emojiId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customEmojis(serverId ?? undefined) });
    },
  });

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setError("Only image files are allowed.");
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError("File must be under 256 KB.");
        return;
      }

      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreview(url);

      // Auto-fill name from filename if empty
      if (!name) {
        const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
        setName(baseName);
      }
    },
    [name],
  );

  const handleUpload = useCallback(() => {
    if (!selectedFile || !name.trim()) return;
    createEmoji.mutate({ emojiName: name.trim(), file: selectedFile });
  }, [selectedFile, name, createEmoji]);

  const handleDelete = useCallback(
    (emoji: CustomEmoji) => {
      deleteEmoji.mutate(emoji.id);
    },
    [deleteEmoji],
  );

  const resetForm = useCallback(() => {
    setName("");
    setSelectedFile(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div>
      <h2 className="text-base font-semibold text-rim-text">Custom Emoji</h2>
      <p className="mt-1 text-sm text-rim-text-muted">
        Add custom emoji that everyone in this workspace can use.
      </p>

      <div className="mt-4 rounded-lg border border-rim-line bg-rim-panel-soft p-4">
        <h3 className="text-sm font-medium text-rim-text">Upload Emoji</h3>
        <div className="mt-3 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-rim-text-muted" htmlFor="emoji-name">
              Name
            </label>
            <input
              id="emoji-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              placeholder="emoji_name"
              className="mt-1 w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
              maxLength={32}
            />
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-rim-line bg-rim-panel px-3 py-1.5 text-sm text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
            >
              {selectedFile ? "Change" : "Choose File"}
            </button>
          </div>
          {preview && (
            <img src={preview} alt="Preview" className="h-8 w-8 rounded object-contain" />
          )}
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || !name.trim() || createEmoji.isPending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded bg-rim-accent px-3 py-1.5 text-sm text-rim-text transition hover:brightness-110",
              (!selectedFile || !name.trim() || createEmoji.isPending) &&
                "cursor-not-allowed opacity-50",
            )}
          >
            <Upload className="h-3.5 w-3.5" />
            {createEmoji.isPending ? "Uploading..." : "Upload"}
          </button>
          {(selectedFile || name) && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-rim-text-faint transition hover:text-rim-text-muted"
            >
              Clear
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-rim-danger">{error}</p>}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-rim-text-faint">Loading emoji...</p>
        ) : emojis.length === 0 ? (
          <p className="text-sm text-rim-text-faint">No custom emoji yet.</p>
        ) : (
          <div className="space-y-2">
            {emojis.map((emoji) => (
              <div
                key={emoji.id}
                className="flex items-center gap-3 rounded-lg border border-rim-line bg-rim-panel-soft px-3 py-2"
              >
                <img src={emoji.imageUrl} alt={emoji.name} className="h-8 w-8 object-contain" />
                <span className="flex-1 text-sm text-rim-text">:{emoji.name}:</span>
                {canDelete(emoji) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(emoji)}
                    disabled={deleteEmoji.isPending}
                    className="rounded p-1 text-rim-text-faint transition hover:text-rim-danger"
                    title="Delete emoji"
                    aria-label={`Delete ${emoji.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
