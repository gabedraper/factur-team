"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun, Eye, X } from "lucide-react";
import { setPreviewRole, clearPreviewRole, setPreviewUser, clearPreviewUser } from "@/actions/preview";

const THEME_KEY = "factur-theme";

export function ThemePanel() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // The inline script in the root layout has already applied the stored choice
  // before paint; read back off the element so the two cannot disagree.
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  function choose(next: "light" | "dark") {
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  }

  return (
    <div className="flex gap-2">
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          onClick={() => choose(t)}
          aria-pressed={theme === t}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
            theme === t ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {t === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

export function PreviewPanel({
  roles, people, currentRole, currentMemberId,
}: {
  roles: { value: string; label: string }[];
  people: { id: string; name: string }[];
  currentRole: string | null;
  currentMemberId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const act = (fn: () => Promise<unknown>, to?: string) =>
    startTransition(async () => {
      await fn();
      if (to) router.push(to);
      router.refresh();
    });

  const previewing = currentRole || currentMemberId;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Preview as role</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={currentRole ?? ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return act(() => clearPreviewRole());
              act(() => setPreviewRole(v), "/learner");
            }}
          >
            <option value="">— not previewing —</option>
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Preview as person</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={currentMemberId ?? ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return act(() => clearPreviewUser());
              act(() => setPreviewUser(v), "/");
            }}
          >
            <option value="">— not previewing —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {previewing && (
        <button
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
          disabled={pending}
          onClick={() => act(async () => { await clearPreviewRole(); await clearPreviewUser(); }, "/settings")}
        >
          <X className="h-3.5 w-3.5" /> Stop previewing
        </button>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Previewing a person shows the app exactly as their permissions allow, including what they
        cannot see. It lasts an hour, and it is a view only — anything you change is still changed
        by you.
      </p>
    </div>
  );
}
