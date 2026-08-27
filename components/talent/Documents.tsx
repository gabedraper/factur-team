"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteDocument, documentUrl, recordDocument } from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/talent/format";

type Doc = {
  id: string; name: string; kind: string; storage_path: string | null;
  mime_type: string | null; size_bytes: number | null; is_primary: boolean;
  created_at: string;
};

const KINDS = [
  ["resume", "Resume"], ["cover_letter", "Cover letter"], ["portfolio", "Portfolio"],
  ["contract", "Contract"], ["reference", "Reference"], ["other", "Other"],
] as const;

/**
 * Resumes and attachments.
 *
 * The file goes from the browser straight into Supabase Storage and only the
 * record of it passes through a server action -- a 20MB CV through a server
 * action body would be refused, and routing it through the server would gain
 * nothing since the bucket enforces its own policies either way.
 *
 * Reading one always mints a fresh signed URL. The bucket is private, so there
 * is no permanent address for a candidate's CV to leak.
 */
export function Documents({
  personId, jobId, documents, canEdit,
}: {
  personId?: string;
  jobId?: string;
  documents: Doc[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>("resume");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function upload(chosen: File) {
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const safe = chosen.name.replace(/[^\w.\-]+/g, "_");
      const path = `${personId ?? jobId ?? "misc"}/${Date.now()}-${safe}`;

      const { error: upErr } = await supabase.storage
        .from("talent-documents")
        .upload(path, chosen, { contentType: chosen.type || undefined, upsert: false });
      if (upErr) throw new Error(upErr.message);

      await recordDocument({
        person_id: personId ?? null,
        job_id: jobId ?? null,
        name: chosen.name,
        kind,
        storage_path: path,
        mime_type: chosen.type || null,
        size_bytes: chosen.size,
        makePrimary: kind === "resume" && !documents.some((d) => d.kind === "resume" && d.is_primary),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload that file");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  async function open(doc: Doc) {
    if (!doc.storage_path) return;
    setError(null);
    try {
      const url = await documentUrl(doc.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that file");
    }
  }

  return (
    <div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KINDS.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            ref={file}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>
      )}

      {error && <p className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {documents.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No files</p>
      ) : (
        <ul className="divide-y">
          {documents.map((d) => (
            <li key={d.id} className="group flex items-center gap-3 px-4 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => open(d)}
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
              >
                {d.name}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {KINDS.find(([k]) => k === d.kind)?.[1] ?? d.kind}
                {d.is_primary ? " · primary" : ""}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(d.created_at)}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => start(async () => {
                    await deleteDocument(d.id, personId);
                    router.refresh();
                  })}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Remove ${d.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
