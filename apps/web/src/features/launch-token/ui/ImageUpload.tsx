"use client";

import { useRef } from "react";

import { Button } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

import { ACCEPTED_IMAGE_MIME } from "../model/schema";
import type { ImageState } from "../model/use-launch";

/**
 * Required token image (§5.3, ≤4 MB). API-MEDIATED upload (spec §12.19): the file
 * is handed to `POST /v1/uploads/image` eagerly on select — the API MIME-sniffs +
 * re-encodes + content-addresses it; there is NO browser presign here. This
 * component only picks the file, previews it, and reflects the upload state owned
 * by `useLaunch`.
 */
export function ImageUpload({
  image,
  onSelect,
  onClear,
  disabled,
}: {
  image: ImageState;
  onSelect: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        Image <span className="text-sell">*</span>
        <span className="ml-1 font-normal">JPG / PNG / WEBP / GIF, ≤4 MB</span>
      </label>

      <div
        className={cn(
          "flex items-center gap-3 rounded-md border border-input bg-background p-3",
          image.error && "border-sell",
        )}
      >
        {image.url ? (
          // Preview from our CDN — the API-re-encoded, content-addressed image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt="Token preview"
            className="h-14 w-14 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-secondary text-xs text-muted-foreground">
            {image.uploading ? "…" : "IMG"}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">
            {image.fileName ?? "No image selected"}
          </p>
          <p className="text-xs text-muted-foreground">
            {image.uploading
              ? "Uploading & re-encoding…"
              : image.url
                ? "Uploaded ✓"
                : "Required"}
          </p>
        </div>

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
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || image.uploading}
            onClick={() => inputRef.current?.click()}
          >
            {image.url ? "Replace" : "Choose"}
          </Button>
          {image.url && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={onClear}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {image.error && <p className="text-xs text-sell">{image.error}</p>}
    </div>
  );
}
