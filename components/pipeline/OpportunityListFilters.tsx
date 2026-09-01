"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

/**
 * Person/Company text filters for the per-client opportunity list. Stage and
 * Lead Status are plain Links (fixed, known values) -- these are free text,
 * so they need a client component to debounce typing before it becomes a
 * navigation. Existing params (stage, status, letter) are preserved; this
 * only ever touches `person` and `company`.
 */
export function OpportunityListFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [person, setPerson] = useState(searchParams.get("person") ?? "");
  const [company, setCompany] = useState(searchParams.get("company") ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      person ? params.set("person", person) : params.delete("person");
      company ? params.set("company", company) : params.delete("company");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 400);
    return () => clearTimeout(handle);
    // Only re-run when what the user typed changes -- searchParams/pathname
    // changing as a *result* of this effect would otherwise loop it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, company]);

  return (
    <div className="flex flex-wrap gap-2">
      <Input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Filter by person…" className="max-w-xs" />
      <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Filter by company…" className="max-w-xs" />
    </div>
  );
}
