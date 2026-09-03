"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptApplication, rejectApplication } from "@/actions/talent-engage";
import { documentUrl } from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { Empty, Panel } from "@/components/talent/bits";
import { ago } from "@/lib/talent/format";

type App = {
  id: string; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; linkedin_url: string | null;
  location: string | null; cover_note: string | null;
  resume_path: string | null; resume_name: string | null;
  created_at: string; status: string;
  tal_jobs: { id: string; title: string } | null;
};

/**
 * The inbox for the careers page.
 *
 * Nothing arriving here is in the working database yet -- accepting is what
 * creates the person and puts them on the search. That is deliberate: public
 * input that can write straight into People is public input that will.
 */
export function ApplicationReview({ applications }: { applications: App[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function openResume(path: string) {
    const result = await documentUrl(path);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener");
  }

  if (!applications.length) {
    return <Panel><Empty>Nothing waiting</Empty></Panel>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {applications.map((a) => (
        <Panel key={a.id}>
          <div className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[a.email, a.phone, a.location].filter(Boolean).join(" · ") || "—"}
                </p>
                {a.tal_jobs && (
                  <p className="text-sm">
                    <Link href={`/talent/jobs/${a.tal_jobs.id}`} className="text-primary hover:underline">
                      {a.tal_jobs.title}
                    </Link>
                  </p>
                )}
              </div>
              <span className="ml-auto text-xs text-muted-foreground">{ago(a.created_at)}</span>
            </div>

            {a.cover_note && (
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm">{a.cover_note}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {a.resume_path && (
                <Button size="sm" variant="outline" onClick={() => openResume(a.resume_path!)}>
                  {a.resume_name ?? "Resume"}
                </Button>
              )}
              {a.linkedin_url && (
                <a
                  href={a.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  LinkedIn
                </a>
              )}

              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === a.id}
                  onClick={() => {
                    setBusy(a.id); setError(null);
                    start(async () => {
                      const res = await acceptApplication(a.id);
                      if (!res.ok) {
                        setError(res.error);
                        setBusy(null);
                        return;
                      }
                      router.push(`/talent/people/${res.personId}`);
                    });
                  }}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === a.id}
                  onClick={() => start(async () => {
                    await rejectApplication(a.id, "rejected");
                    router.refresh();
                  })}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === a.id}
                  onClick={() => start(async () => {
                    await rejectApplication(a.id, "spam");
                    router.refresh();
                  })}
                >
                  Spam
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
