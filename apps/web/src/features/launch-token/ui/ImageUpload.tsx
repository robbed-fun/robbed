"use client";

import { useRef } from "react";

import { MonoText } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

import { ACCEPTED_IMAGE_MIME } from "../model/schema";
import type { ImageState } from "../model/use-launch";

/**
 * Required token image (§5.3, ≤4 MB) — ROBBED_ terminal skin (docs/Robbed.html):
 * a square `logo 512×512` slot with a DASHED hairline frame; the whole square is
 * the tap target (mobile-first). API-MEDIATED upload (spec §12.19): the file is
 * handed to `POST /v1/uploads/image` eagerly on select — the API MIME-sniffs +
 * re-encodes + content-addresses it; there is NO browser presign here. This
 * component only picks the file, previews the API-re-encoded result, and reflects
 * the upload state owned by `useLaunch`. Correctness of the upload/sign path is
 * unchanged; this is a re-skin only.
 */
export function ImageUpload({
  image,
  onSelect,
  onClear,
  disabled,
  className,
}: {
  image: ImageState;
  onSelect: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <button
        type="button"
        disabled={disabled || image.uploading}
        onClick={() => inputRef.current?.click()}
        aria-label="Upload token logo, 512 by 512"
        className={cn(
          "group relative flex aspect-square w-full items-center justify-center overflow-hidden border border-dashed border-border-strong bg-transparent transition-colors hover:border-green focus:outline-none focus-visible:border-green disabled:cursor-not-allowed disabled:opacity-50",
          image.error && "border-red",
        )}
      >
        {image.url ? (
          // Preview from our CDN — the API-re-encoded, content-addressed image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt="Token logo preview"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex flex-col items-center gap-0.5 text-center leading-tight">
            <MonoText tone="faint" size="xs">
              logo
            </MonoText>
            <MonoText tone="faint" size="xs" numeric>
              512×512
            </MonoText>
          </span>
        )}

        {image.uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-bg/70">
            <MonoText tone="faint" size="xs">
              uploading…
            </MonoText>
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          // Reset so re-selecting the same file re-triggers change.
          e.target.value = "";
        }}
      />

      {image.url && !image.uploading && (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="self-start text-2xs uppercase tracking-label text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          remove
        </button>
      )}

      {image.error && (
        <MonoText tone="red" size="xs">
          {image.error}
        </MonoText>
      )}
    </div>
  );
}
