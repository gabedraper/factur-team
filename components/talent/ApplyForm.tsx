"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * The public application form.
 *
 * It talks to the database directly as `anon`: the resume goes into the one
 * folder anonymous visitors may write to, and the application itself goes
 * through `tal_submit_application`, which is the only function that can create
 * one and which re-checks that the role is actually open. Nothing here can
 * reach People or a pipeline -- a human accepts the application first.
 */
export function ApplyForm({ slug }: { slug: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    linkedin_url: "", location: "", cover_note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();

      let resumePath: string | null = null;
      let resumeName: string | null = null;
      const chosen = file.current?.files?.[0];
      if (chosen) {
        if (chosen.size > 25 * 1024 * 1024) throw new Error("That file is over 25MB");
        const safe = chosen.name.replace(/[^\w.\-]+/g, "_");
        const path = `applications/${slug}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("talent-documents")
          .upload(path, chosen, { contentType: chosen.type || undefined });
        if (upErr) throw new Error(upErr.message);
        resumePath = path;
        resumeName = chosen.name;
      }

      const { error: rpcErr } = await supabase.rpc("tal_submit_application", {
        p_slug: slug,
        p_first_name: form.first_name,
        p_last_name: form.last_name,
        p_email: form.email,
        p_phone: form.phone || null,
        p_linkedin_url: form.linkedin_url || null,
        p_location: form.location || null,
        p_cover_note: form.cover_note || null,
        p_resume_path: resumePath,
        p_resume_name: resumeName,
        p_source: "careers",
      });
      if (rpcErr) throw new Error(rpcErr.message);

      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        Thanks — your application is in. Somebody will be in touch.
      </p>
    );
  }

  const ready = form.first_name.trim() && form.last_name.trim() && form.email.includes("@");

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm">First name</span>
          <input className="w-full rounded-md border bg-background px-3 py-2"
            value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">Last name</span>
          <input className="w-full rounded-md border bg-background px-3 py-2"
            value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">Email</span>
          <input type="email" className="w-full rounded-md border bg-background px-3 py-2"
            value={form.email} onChange={(e) => set("email", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">Phone</span>
          <input className="w-full rounded-md border bg-background px-3 py-2"
            value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">Location</span>
          <input className="w-full rounded-md border bg-background px-3 py-2"
            value={form.location} onChange={(e) => set("location", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">LinkedIn</span>
          <input className="w-full rounded-md border bg-background px-3 py-2"
            value={form.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm">Resume</span>
        <input ref={file} type="file" accept=".pdf,.doc,.docx,.txt"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm">Anything else</span>
        <textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2"
          value={form.cover_note} onChange={(e) => set("cover_note", e.target.value)} />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button onClick={submit} disabled={busy || !ready}>
        {busy ? "Sending…" : "Apply"}
      </Button>
    </div>
  );
}
