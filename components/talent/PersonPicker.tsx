"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { quickSearchPeople } from "@/actions/talent";
import { Avatar } from "@/components/talent/bits";
import { FIELD } from "@/lib/field-class";

export type PickedPerson = {
  id: string; name: string; title: string | null;
  company: string | null; primary_email: string | null;
};

/**
 * Type-ahead over the people database.
 *
 * The search runs 250ms after the last keystroke and an older reply is thrown
 * away if a newer one has already landed -- without that, typing quickly leaves
 * the results for "ma" sitting under a box that says "martinez".
 */
export function PersonPicker({
  onPick, placeholder = "Search people", autoFocus,
}: {
  onPick: (person: PickedPerson) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickedPerson[]>([]);
  const [, start] = useTransition();
  const latest = useRef(0);

  useEffect(() => {
    if (!term.trim()) { setResults([]); return; }
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      start(async () => {
        const found = await quickSearchPeople(term);
        if (mine === latest.current) setResults(found);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          className={`w-full py-1.5 pl-8 pr-2 text-sm ${FIELD}`}
          value={term}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      {results.length > 0 && (
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border bg-card">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onPick(p); setTerm(""); setResults([]); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <Avatar name={p.name} size={6} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.title, p.company, p.primary_email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
