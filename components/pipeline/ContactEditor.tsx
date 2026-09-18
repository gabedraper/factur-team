"use client";

import { Phone as PhoneIcon } from "lucide-react";
import { Panel } from "@/components/pipeline/bits";
import { useDialer } from "@/components/work-panel/dialer-context";
import { toE164 } from "@/lib/phone";

/**
 * Read-only on purpose: crm_contacts is a one-way Salesforce sync (see
 * lib/integrations/catalogue.ts), so an edit made here can't push back and
 * gets silently overwritten the next time that sync runs. An editable
 * version of this panel existed briefly but never actually stuck -- the
 * save button looked permanently "dirty" because nothing here re-fetched
 * the saved value afterward, which read as "isn't saving" even when it
 * technically was. Fixing that properly wasn't worth it for a value this
 * panel doesn't own; wrong numbers get fixed in Salesforce.
 */
export function ContactEditor({
  opportunityId, contactName, phone, mobilePhone, directPhone, companyPhone,
  email, linkedinUrl, title, company, industry, domain,
}: {
  opportunityId: string;
  contactName: string;
  phone: string | null;
  mobilePhone?: string | null;
  directPhone?: string | null;
  companyPhone?: string | null;
  email: string | null;
  linkedinUrl: string | null;
  title: string | null;
  company: string | null;
  industry: string | null;
  domain: string | null;
}) {
  // This is the Opportunity's own contact, so the call is tagged with it and
  // logged against it -- callOpportunity, not the ad hoc requestCall.
  const { callOpportunity } = useDialer();

  /*
   * Every number Salesforce holds, each one a dial button. The plain "phone"
   * is Salesforce's main number, which is usually the direct or mobile line
   * repeated; a number shown once under its own label is not shown again as
   * "Phone", so a rep sees three distinct ways to reach the person rather
   * than the same one twice.
   */
  const lines = [
    { label: "Direct", value: directPhone },
    { label: "Mobile", value: mobilePhone },
    { label: "Company", value: companyPhone },
  ].filter((l): l is { label: string; value: string } => !!l.value);
  if (phone && !lines.some((l) => l.value === phone)) lines.unshift({ label: "Phone", value: phone });

  const dial = (value: string) => {
    const dialable = toE164(value);
    return (
      <button
        type="button"
        className="flex items-center gap-1.5 underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
        title={dialable ? `Call ${dialable}` : "This number doesn't look valid"}
        disabled={!dialable}
        onClick={() => dialable && callOpportunity({ opportunityId, phoneNumber: value, contactName })}
      >
        {value}
        <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    );
  };

  return (
    <Panel title="Contact">
      <dl className="space-y-2 p-4 text-body">
        {/* The number itself dials -- a rep reads it and clicks it in the
            same movement, rather than reading it here and hitting a button
            beside it. Still the in-app dialer and not a tel: link, so the
            call is logged against this opportunity. */}
        {lines.length === 0 ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Phone</dt>
            <dd>—</dd>
          </div>
        ) : (
          lines.map((l) => (
            <div key={l.label} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="flex items-center gap-2 tabular-nums">{dial(l.value)}</dd>
            </div>
          ))
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate">
            {email ? (
              <a href={`mailto:${email}`} className="underline-offset-2 hover:underline">
                {email}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Website</dt>
          {/* crm_accounts stores a bare domain, so the scheme goes back on for
              the href while the text stays the domain -- nobody wants to read
              "https://" in a panel. Blank reads as an em dash like the rest of
              these rows: the company is real, we just don't hold its site. */}
          <dd className="truncate">
            {domain ? (
              <a
                href={`https://${domain}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {domain}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Industry</dt>
          <dd>{industry ?? "—"}</dd>
        </div>
      </dl>
      <LinkedInPreview url={linkedinUrl} name={contactName} title={title} company={company} />
    </Panel>
  );
}

/*
 * LinkedIn refuses to be framed -- every profile page sends
 * X-Frame-Options: DENY -- so an embedded profile is not something an app can
 * offer, and scraping one is against their terms. What can be shown is the
 * profile card as Salesforce holds it: the person, their headline, and the
 * public address, one click from the real thing. The handle is the part of
 * the URL a person actually recognises, so it is what gets printed.
 */
function LinkedInPreview({
  url, name, title, company,
}: {
  url: string | null;
  name: string;
  title: string | null;
  company: string | null;
}) {
  if (!url) return null;
  const handle = url.replace(/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i, "").replace(/\/.*$/, "");
  const headline = [title, company].filter(Boolean).join(" · ");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  return (
    <div className="border-t px-4 py-3">
      <div className="flex items-center gap-3 rounded-md bg-card-hover/60 p-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-body font-semibold text-primary-foreground"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{name}</span>
          {headline && <span className="block truncate text-meta text-muted-foreground">{headline}</span>}
          <span className="block truncate text-meta text-muted-foreground">linkedin.com/in/{handle}</span>
        </span>
        {/* LinkedIn's own mark, in its blue, is the link -- the one thing on
            the card that looks like a button is the one thing that is. */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`Open ${name} on LinkedIn`}
          aria-label={`Open ${name} on LinkedIn`}
          className={/* design-ok: LinkedIn's brand blue; the mark is only recognisable in its own colour, in both themes */ "flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#0A66C2] text-white transition-opacity duration-fast ease-out hover:opacity-85"}
        >
          <LinkedInMark className="h-5 w-5" />
        </a>
      </div>
    </div>
  );
}

/* LinkedIn's "in" wordmark. Lucide's outline icon is a generic glyph; the
   brand mark on brand blue is what people recognise as "opens LinkedIn". */
function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}
