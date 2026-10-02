"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api/contract";
import { AVATAR_MIME_TYPES } from "@/lib/avatar";
import { useUpdateProfile } from "@/lib/queries";
import type { UserProfile } from "@/lib/types";

import { AvatarFileError, prepareAvatar } from "../lib/avatar-image";

const ACCEPT = AVATAR_MIME_TYPES.join(",");

/**
 * Photo of the signed-in person. It saves on its own (not with the form's
 * "Enregistrer" button) and shows the new photo as soon as it is chosen.
 */
export function ProfilePhoto({ profile, name }: { profile: UserProfile; name: string }) {
  const update = useUpdateProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Photo being saved or just saved; undefined until the person changes it.
  const [override, setOverride] = useState<string | null | undefined>(undefined);

  const current = override !== undefined ? override : (profile.avatarUrl ?? null);
  const busy = preparing || update.isPending;

  const save = async (avatarUrl: string | null) => {
    setOverride(avatarUrl);
    try {
      await update.mutateAsync({ avatarUrl });
      toast.success(avatarUrl ? "Photo de profil mise à jour" : "Photo de profil supprimée");
    } catch (failure) {
      setOverride(undefined);
      setError(getErrorMessage(failure));
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Lets the same file be chosen again after an error or a removal.
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      const avatarUrl = await prepareAvatar(file);
      setPreparing(false);
      await save(avatarUrl);
    } catch (failure) {
      setPreparing(false);
      setError(failure instanceof AvatarFileError ? failure.message : getErrorMessage(failure));
    }
  };

  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        name={name}
        src={current}
        size="lg"
        className="data-[size=lg]:size-16 *:data-[slot=avatar-fallback]:text-lg"
      />
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label="Choisir une photo de profil"
            onChange={(event) => void onFile(event)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Spinner /> : <Camera />}
            Changer la photo
          </Button>
          {current ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                void save(null);
              }}
            >
              <Trash2 />
              Supprimer la photo
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP, 5 Mo au maximum.</p>
        )}
      </div>
    </div>
  );
}
