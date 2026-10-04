import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, Loader2 } from "lucide-react";

import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useUpdateProfileMutation, uploadAvatar } from "../api/useUpdateProfile";
import { cn } from "../../../shared/ui/cn";

function resizeImageToBlob(file: File, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;

      // Center-crop: use the largest square from the center of the image
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Failed to load image"));
    };
    img.src = blobUrl;
  });
}

export function ProfileSettings() {
  const { data: user, isPending: userLoading } = useCurrentUser();
  const updateProfile = useUpdateProfileMutation();

  const [displayName, setDisplayName] = useState("");
  const [statusText, setStatusText] = useState("");
  const [bio, setBio] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Populate form when user data loads
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? "");
      setStatusText(user.statusText ?? "");
      setBio(user.bio ?? "");
      setAvatarPreview(user.avatarUrl ?? null);
    }
  }, [user]);

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setAvatarError("Please select an image file.");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setAvatarError("Image must be under 2MB.");
        return;
      }

      setAvatarError(null);
      setAvatarUploading(true);

      try {
        const resized = await resizeImageToBlob(file, 256);
        const url = await uploadAvatar(resized);
        setAvatarPreview(url);

        // Update profile with new avatar URL
        await updateProfile.mutateAsync({ avatarUrl: url });
      } catch (err) {
        setAvatarError(err instanceof Error ? err.message : "Avatar upload failed.");
      } finally {
        setAvatarUploading(false);
        // Reset input so same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [updateProfile],
  );

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      await updateProfile.mutateAsync({
        displayName: displayName || undefined,
        statusText: statusText || undefined,
        bio: bio || undefined,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile.");
    }
  }, [displayName, statusText, bio, updateProfile]);

  if (userLoading) {
    return <p className="text-sm text-rim-text-muted">Loading profile...</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-rim-text">Profile</h2>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleAvatarClick}
          className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-rim-panel-soft transition hover:brightness-110"
          title="Change avatar"
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl font-medium text-rim-text-muted">
              {user?.displayName?.charAt(0).toUpperCase() ??
                user?.username?.charAt(0).toUpperCase() ??
                "?"}
            </span>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
            {avatarUploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : (
              <Camera className="h-5 w-5 text-white" />
            )}
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
        <div className="text-sm text-rim-text-muted">
          Click to upload avatar. Max 2MB, images only.
          {avatarError && <p className="mt-1 text-rim-danger">{avatarError}</p>}
        </div>
      </div>

      {/* Display name */}
      <div>
        <label
          htmlFor="profile-display-name"
          className="mb-1 block text-sm font-medium text-rim-text"
        >
          Display name
        </label>
        <input
          id="profile-display-name"
          type="text"
          maxLength={64}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your display name"
          className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
        />
        <p className="mt-1 text-xs text-rim-text-faint">{displayName.length}/64</p>
      </div>

      {/* Status text */}
      <div>
        <label htmlFor="profile-status" className="mb-1 block text-sm font-medium text-rim-text">
          Status
        </label>
        <input
          id="profile-status"
          type="text"
          maxLength={256}
          value={statusText}
          onChange={(e) => setStatusText(e.target.value)}
          placeholder="What are you working on?"
          className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
        />
        <p className="mt-1 text-xs text-rim-text-faint">{statusText.length}/256</p>
      </div>

      {/* Bio */}
      <div>
        <label htmlFor="profile-bio" className="mb-1 block text-sm font-medium text-rim-text">
          Bio
        </label>
        <textarea
          id="profile-bio"
          maxLength={2000}
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell others about yourself"
          className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
        />
        <p className="mt-1 text-xs text-rim-text-faint">{bio.length}/2000</p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={updateProfile.isPending}
          className={cn(
            "rounded-lg bg-rim-accent px-4 py-2 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50",
          )}
        >
          {updateProfile.isPending ? "Saving..." : "Save"}
        </button>
        {updateProfile.isSuccess && !saveError && (
          <span className="text-sm text-rim-success">Saved!</span>
        )}
        {saveError && <span className="text-sm text-rim-danger">{saveError}</span>}
      </div>
    </div>
  );
}
