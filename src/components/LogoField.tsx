"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";

/**
 * Choosing a company's letterhead.
 *
 * The file is turned into a data URI in the browser and posted as text, so the
 * logo lives in the company row rather than on the container's filesystem —
 * which does not survive a deploy. A report that quietly loses its letterhead
 * between releases is worse than one that never had it.
 *
 * Held to a small size on purpose: this is read on every printed report, and a
 * two-megabyte photograph of a signboard is not a letterhead.
 */
const MAX_BYTES = 400 * 1024;

export default function LogoField({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input type="hidden" name="logoUrl" value={value} />

      <div className="flex items-start gap-3">
        {value ? (
          <span className="theme-light grid h-16 w-28 place-items-center rounded border border-line bg-surface p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="max-h-14 max-w-full object-contain" />
          </span>
        ) : (
          <span className="grid h-16 w-28 place-items-center rounded border border-dashed border-line text-xs text-muted">
            No logo
          </span>
        )}

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-ghost h-9 py-1.5 text-sm"
            >
              <Upload className="h-4 w-4" /> Choose an image
            </button>
            {value && (
              <button
                type="button"
                onClick={() => { setValue(""); setError(""); }}
                className="rounded px-2 py-1 text-xs text-muted hover:bg-line hover:text-ink"
              >
                <X className="mr-1 inline h-3 w-3" /> Remove
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setError("");
              if (file.size > MAX_BYTES) {
                setError(
                  `That image is ${Math.round(file.size / 1024)} KB. Keep it under ${MAX_BYTES / 1024} KB — a letterhead only needs to be a few hundred pixels wide.`
                );
                return;
              }
              const reader = new FileReader();
              reader.onload = () => setValue(String(reader.result ?? ""));
              reader.onerror = () => setError("That file could not be read.");
              reader.readAsDataURL(file);
            }}
          />

          <p className="mt-1 text-xs text-muted">
            Shown at the top of this company&rsquo;s printed reports. Each company in the group can have its own, so
            a report never goes out on another company&rsquo;s letterhead. PNG with a transparent background prints
            best.
          </p>
          {error && <p className="mt-1 text-xs text-brand-gold">{error}</p>}
        </div>
      </div>
    </div>
  );
}
