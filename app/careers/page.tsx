import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { place, salaryRange } from "@/lib/talent/format";
import { EMPLOYMENT_TYPE, REMOTE, label } from "@/lib/talent/types";

/*
 * The public careers page. No account, no sidebar, no Factur chrome.
 *
 * It sits outside the (dashboard) route group so it gets the bare root layout,
 * and outside `protectedPrefixes` in middleware.ts so nobody is asked to sign
 * in to read a job advert. Everything it shows comes from `tal_public_jobs()`,
 * which is the only thing `anon` may call -- a policy on tal_jobs generous
 * enough to serve this page would be a policy that leaks confidential searches.
 */
export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const supabase = await createClient();

  const [{ data: jobs }, { data: config }] = await Promise.all([
    supabase.rpc("tal_public_jobs"),
    // Not a select on tal_settings: that row is staff-only, so reading it as a
    // visitor returned nothing and the configured heading never appeared on
    // the page it was written for.
    supabase.rpc("tal_public_careers"),
  ]);

  type Row = {
    public_slug: string; title: string; company_name: string | null;
    city: string | null; state: string | null; remote: string;
    employment_type: string; salary_min: number | null; salary_max: number | null;
    salary_currency: string; salary_period: string;
  };
  const rows = (jobs ?? []) as Row[];

  const careers = ((config ?? []) as {
    heading: string; intro: string | null; enabled: boolean;
  }[])[0];

  // Switched off is a 404 rather than an empty list, which would read as a
  // broken deploy on a page the public is looking at.
  if (!careers?.enabled) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        {careers.heading || "Open roles"}
      </h1>
      {careers.intro && (
        <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{careers.intro}</p>
      )}

      {rows.length === 0 ? (
        <p className="mt-10 text-muted-foreground">Nothing open right now.</p>
      ) : (
        <ul className="mt-10 divide-y border-y">
          {rows.map((j) => (
            <li key={j.public_slug}>
              <Link
                href={`/careers/${j.public_slug}`}
                className="block py-5 transition-colors hover:bg-accent/40"
              >
                <p className="text-lg font-medium">{j.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[
                    j.company_name,
                    place(j.city, j.state),
                    label(REMOTE, j.remote),
                    label(EMPLOYMENT_TYPE, j.employment_type),
                  ].filter((v) => v && v !== "—").join(" · ")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {salaryRange(j.salary_min, j.salary_max, j.salary_currency, j.salary_period)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
