import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_FILE_BYTES,
  AVATAR_MIME_TYPES,
  AVATAR_SIZE_PX,
} from "@/lib/avatar";

/** A refusal whose message is meant to be shown to the person as is. */
export class AvatarFileError extends Error {}

const QUALITIES = [0.85, 0.7, 0.5] as const;

function isAcceptedType(type: string): boolean {
  return (AVATAR_MIME_TYPES as readonly string[]).includes(type);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new AvatarFileError("Cette image est illisible."));
    };
    reader.onerror = () => reject(new AvatarFileError("Cette image est illisible."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Crops the middle square of an image, resizes it to 256 × 256 and returns it
 * as a data URL (WebP, or JPEG where the browser cannot encode WebP).
 * Throws an `AvatarFileError` for a file that is not an image or is too big.
 */
export async function prepareAvatar(file: File): Promise<string> {
  if (!isAcceptedType(file.type)) {
    throw new AvatarFileError("Choisissez une image PNG, JPEG ou WebP.");
  }
  if (file.size > AVATAR_MAX_FILE_BYTES) {
    throw new AvatarFileError("Cette image dépasse 5 Mo. Choisissez-en une plus légère.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarFileError("Cette image est illisible.");
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE_PX;
    canvas.height = AVATAR_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new AvatarFileError("Votre navigateur ne peut pas traiter cette image.");

    const side = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - side) / 2;
    const sourceY = (bitmap.height - side) / 2;
    const draw = (background: string | null) => {
      context.clearRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
    };

    draw(null);
    let type = "image/webp";
    let blob = await toBlob(canvas, type, QUALITIES[0]);
    if (blob?.type !== "image/webp") {
      // JPEG has no transparency: flatten onto white rather than black.
      type = "image/jpeg";
      draw("#ffffff");
      blob = await toBlob(canvas, type, QUALITIES[0]);
    }
    for (const quality of QUALITIES.slice(1)) {
      if (blob && blob.size <= AVATAR_MAX_BYTES) break;
      blob = await toBlob(canvas, type, quality);
    }
    if (!blob || blob.size > AVATAR_MAX_BYTES) {
      throw new AvatarFileError("Cette image n’a pas pu être réduite. Essayez-en une autre.");
    }
    return await readAsDataUrl(blob);
  } finally {
    bitmap.close();
  }
}
