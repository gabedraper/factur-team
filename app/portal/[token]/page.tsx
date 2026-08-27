import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalFeedback } from "@/components/talent/PortalFeedback";
import { onDay, place } from "@/lib/talent/format";

/*
 * The hiring-manager portal.
 *
 * A client interviewer has no account here and is never going to make one, so
 * the token in the URL is the credential. Everything on the page comes from
 * `tal_portal_view()`, which decides what may be shown -- contact details are
 * off unless the person who shared it turned them on, because handing a client
 * a candidate's mobile number is how an agency stops being needed.
 */
export const dynamic = "force-dynamic";

type Submission = {
  id: string;
  headline: string | null;
  summary: string | null;
  status: string;
  decision: string | null;
  feedback: string | null;
  shared_at: string | null;
  person: {
    name: string; title: string | null; company: string | null;
    location: string | null; summary: string | null;
    email: string | null; phone: string | null;
    work_history: { title: string | null; company: string | null; started_on: string | null; ended_on: string | null }[] | null;
  };
};

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("tal_portal_view", { p_token: token });

  const view = data as {
    recipient_name: string | null;
    can_leave_feedback: boolean;
    job: { title: string; city: string | null; state: string | null; remote: string; description: string | null; company: string | null } | null;
    submissions: Submission[];
  } | null;

  // Expired, revoked and never-existed all look the same on purpose: telling
  // them apart only helps somebody guessing tokens.
  if (!view) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{view.job?.title ?? "Candidates"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[view.job?.company, place(view.job?.city, view.job?.state)]
            .filter((v) => v && v !== "—").join(" · ")}
        </p>
        {view.recipient_name && (
          <p className="mt-4 text-sm text-muted-foreground">For {view.recipient_name}</p>
        )}
      </header>

      {view.submissions.length === 0 ? (
        <p className="mt-12 text-muted-foreground">Nothing shared yet.</p>
      ) : (
        <ol className="mt-10 space-y-6">
          {view.submissions.map((s) => (
            <li key={s.id} className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-medium">{s.person.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[s.person.title, s.person.company, s.person.location]
                      .filter((v) => v && v !== "—").join(" · ")}
                  </p>
                </div>
                {s.shared_at && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {onDay(s.shared_at)}
                  </span>
                )}
              </div>

              {s.headline && <p className="mt-3 font-medium">{s.headline}</p>}
              {s.summary && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{s.summary}</p>}
              {!s.summary && s.person.summary && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{s.person.summary}</p>
              )}

              {(s.person.email || s.person.phone) && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {[s.person.email, s.person.phone].filter(Boolean).join(" · ")}
                </p>
              )}

              {s.person.work_history?.length ? (
                <ul className="mt-4 space-y-1.5 border-t pt-4 text-sm">
                  {s.person.work_history.map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{h.title ?? "—"}</span>
                      <span className="text-muted-foreground">{h.company ?? ""}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {onDay(h.started_on)} – {h.ended_on ? onDay(h.ended_on) : "present"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-4 border-t pt-4">
                <PortalFeedback
                  token={token}
                  submissionId={s.id}
                  decision={s.decision}
                  feedback={s.feedback}
                  canRespond={view.can_leave_feedback}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
