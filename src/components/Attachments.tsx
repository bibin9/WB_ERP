"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { uploadAttachment, deleteAttachment } from "@/app/(app)/attachments/actions";
import { ACCEPT_ATTRIBUTE } from "@/lib/uploads";
import { fileSize } from "@/lib/attachments";

export type AttachmentRow = {
  id: string;
  kind: string;
  fileName: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
};

/**
 * The files filed against a bill or an order.
 *
 * What it is comes first on each line, not the file name: "Government fee
 * receipt" is what an approver is looking for, and `IMG_4471.pdf` tells them
 * nothing. Uploading asks for that label before it asks for the file.
 */
export default function Attachments({
  entity,
  entityId,
  kinds,
  rows,
  canAdd,
  canRemove,
  note,
}: {
  entity: string;
  entityId: string;
  kinds: string[];
  rows: AttachmentRow[];
  canAdd: boolean;
  canRemove: boolean;
  note?: string;
}) {
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState("");
  const [kind, setKind] = useState(kinds[0] ?? "Other");
  const fileRef = useRef<HTMLInputElement>(null);

  const send = (file: File) => {
    setError("");
    const fd = new FormData();
    fd.set("entity", entity);
    fd.set("entityId", entityId);
    fd.set("kind", kind);
    fd.set("file", file);
    startBusy(async () => {
      const res = await uploadAttachment(fd);
      if (!res.ok) setError(res.error ?? "Could not attach that file.");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2 text-heading">
        <Paperclip className="h-4 w-4" />
        <h2 className="font-semibold">Attachments</h2>
        <span className="text-xs text-muted">{rows.length === 0 ? "none yet" : `${rows.length}`}</span>
      </div>

      {note && <p className="mb-3 max-w-2xl text-xs text-muted">{note}</p>}

      {rows.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-44 shrink-0 truncate font-medium text-ink">{r.kind}</span>
              <a
                href={`/api/attachments/${r.id}`}
                className="min-w-0 flex-1 truncate text-brand-blue-600 hover:underline"
                title={r.fileName}
              >
                {r.fileName}
              </a>
              <span className="shrink-0 text-xs tabular-nums text-muted">{fileSize(r.size)}</span>
              <span className="hidden shrink-0 text-xs text-muted sm:inline">
                {r.uploadedBy} · {r.createdAt}
              </span>
              {canRemove && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startBusy(async () => {
                    const res = await deleteAttachment(r.id);
                    if (!res.ok) setError(res.error ?? "Could not remove it.");
                  })}
                  className="shrink-0 rounded p-1 text-muted hover:bg-line hover:text-red-600 disabled:opacity-40"
                  title={`Remove ${r.fileName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAdd && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            <span className="mb-1 block">What is it?</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="input h-9 w-56 py-1 text-sm">
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }}
            className="hidden"
            id={`attach-${entityId}`}
          />
          <label
            htmlFor={`attach-${entityId}`}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-4 text-sm text-ink hover:bg-line"
          >
            <Upload className="h-4 w-4" /> {busy ? "Attaching…" : "Attach a file"}
          </label>
          <span className="text-xs text-muted">PDF, image, Word or Excel, up to 10MB.</span>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
