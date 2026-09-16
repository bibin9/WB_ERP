"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";

/**
 * A letterhead band — the company's own header or footer artwork.
 *
 * Turned into a data URI in the browser and posted as text, like the logo, so
 * it lives in the database and survives a deploy. PNG and JPEG only: documents
 * are PDFs, and a PDF cannot carry an SVG or WebP image as drawn.
 */
export default function ArtworkField({
  name,
  label,
  hint,
  empty,
  maxBytes,
  defaultValue = "",
}: {
  name: string;
  label: string;
  hint: string;
  /** What is printed instead when there is no artwork. */
  empty: string;
  maxBytes: number;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input type="hidden" name={name} value={value} />

      {value ? (
        <div className="theme-light rounded border border-line bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="max-h-24 w-full object-contain" />
        </div>
      ) : (
        <div className="grid h-16 place-items-center rounded border border-dashed border-line text-xs text-muted">
          {empty}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost h-9 py-1.5 text-sm">
          <Upload className="h-4 w-4" /> {value ? "Replace" : "Choose an image"}
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
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setError("");
          if (!/^image\/(png|jpeg)$/.test(file.type)) {
            setError("Choose a PNG or JPEG. If your designer sent a PDF or SVG, ask them for a PNG export.");
            return;
          }
          if (file.size > maxBytes) {
            setError(
              `That image is ${Math.round(file.size / 1024)} KB. Keep it under ${maxBytes / 1024} KB — about 2000 pixels wide is plenty for a band across an A4 page.`,
            );
            return;
          }
          const reader = new FileReader();
          reader.onload = () => setValue(String(reader.result ?? ""));
          reader.onerror = () => setError("That file could not be read.");
          reader.readAsDataURL(file);
        }}
      />

      <p className="mt-1 text-xs text-muted">{hint}</p>
      {error && <p className="mt-1 text-xs text-brand-gold">{error}</p>}
    </div>
  );
}
