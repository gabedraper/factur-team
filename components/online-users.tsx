"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Presence = { id: string; name: string; avatarUrl: string | null };

const CHANNEL = "online-users";
const SHOWN = 5;

// Stable per person, so the same face keeps the same colour between sessions.
const COLOURS = [
  "bg-sky-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-teal-600",
  "bg-indigo-600",
];

function colourFor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COLOURS[sum % COLOURS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Everyone with the app open, over Supabase Realtime presence. This is who is
 * *here* rather than who holds a valid session -- a signed-in person with no
 * tab open drops off, which is what people mean when they ask who is around.
 */
export function OnlineUsers({ me }: { me: Presence }) {
  const [people, setPeople] = useState<Presence[]>([me]);
  const { id, name, avatarUrl } = me;

  useEffect(() => {
    const me: Presence = { id, name, avatarUrl };
    const supabase = createClient();
    // Keyed on the user id, so a second tab joins the same entry instead of
    // showing the person twice.
    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: me.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Presence>();
        const here = Object.values(state)
          .map((metas) => metas[0])
          .filter(Boolean)
          .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
        setPeople(here.length ? here : [me]);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track(me);
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // Primitives, so a re-render of the layout does not tear the channel down.
  }, [id, name, avatarUrl]);

  const shown = people.slice(0, SHOWN);
  const rest = people.slice(SHOWN);

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((p) => (
        <div
          key={p.id}
          title={p.id === me.id ? `${p.name} (you)` : p.name}
          className={`h-7 w-7 rounded-full ring-2 ring-card overflow-hidden flex items-center justify-center text-[11px] font-medium text-white ${
            p.avatarUrl ? "bg-muted" : colourFor(p.id)
          }`}
        >
          {p.avatarUrl ? (
            // Google avatars, so no next/image domain to configure.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatarUrl} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            initials(p.name)
          )}
        </div>
      ))}
      {rest.length > 0 && (
        <div
          title={rest.map((p) => p.name).join("\n")}
          className="h-7 w-7 rounded-full ring-2 ring-card bg-muted flex items-center justify-center text-[11px] font-medium text-muted-foreground"
        >
          +{rest.length}
        </div>
      )}
    </div>
  );
}
