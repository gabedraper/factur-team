"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Phone, ListChecks, PanelRightClose, PanelRightOpen, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialWidget } from "@/components/pipeline/DialWidget";
import { TwilioDialWidget } from "@/components/pipeline/TwilioDialWidget";
import { TelnyxDialWidget } from "@/components/pipeline/TelnyxDialWidget";
import { GaibWidget } from "@/components/gaib/gaib-widget";
import { RailWork } from "@/components/work/RailWork";
import { useCallActive } from "@/lib/calls/active";
import { useExpandCallsSignal } from "@/lib/calls/expand";
import type { WorkItem } from "@/lib/work";

const STORAGE_KEY = "factur-work-panel-collapsed";
const WIDTH_KEY = "factur-work-panel-width";
const SECTIONS_KEY = "factur-work-panel-shut";

/*
 * How wide it is allowed to get.
 *
 * The floor is what the dialpad needs to stay usable: its iframe is a fixed
 * 400px (Dialpad's own documented size -- see DialWidget.tsx) inside p-3
 * padding, so anything under ~424px squishes Dialpad's own UI rather than
 * letting it reflow. 480 leaves it breathing room instead of sitting right
 * at that edge. The ceiling is about the page rather than the panel -- a
 * rail past half the window stops being a rail.
 */
const MIN_WIDTH = 480;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

/**
 * The persistent right rail -- left is navigation, this is work: whatever a
 * rep is actively doing, regardless of which page they're looking at.
 * Calls today; ClickUp tasks and whatever comes next go here as their own
 * sections later, same pattern as this one. Gaib lives here too, pinned to
 * the bottom, rather than in the left sidebar -- the same reasoning as
 * everything else in this panel: it's work you reach for from any page.
 */
export function WorkPanel({
  showCalls, dialpadConfigured, telnyxConfigured, twilioConfigured, work = [],
}: {
  showCalls: boolean;
  dialpadConfigured: boolean;
  telnyxConfigured: boolean;
  twilioConfigured: boolean;
  /** Open ClickUp work assigned to the viewer. Empty until the mirror runs. */
  work?: WorkItem[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [shut, setShut] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const onCall = useCallActive();

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");

    const savedWidth = Number(localStorage.getItem(WIDTH_KEY));
    if (savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) setWidth(savedWidth);

    try {
      const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "[]");
      if (Array.isArray(saved)) setShut(saved);
    } catch {
      // Corrupt value from an older build -- everything open is a fine default.
    }
  }, []);

  /*
   * A live call outranks a stored preference.
   *
   * Somebody who folded Calls away last Tuesday and is on a call now needs the
   * hang-up button, and hunting for it while a customer is talking is not a
   * thing to make anyone do. The preference is not overwritten -- it comes
   * back when the call ends.
   */
  const callsShut = shut.includes("calls") && !onCall;

  /*
   * requestCall() (dialer-context.tsx) fires this when something outside the
   * panel -- a contact's phone field, say -- wants to dial a number right
   * now. The dial widget below is unmounted whenever the panel is collapsed
   * or Calls is shut, so nothing would be listening for that request unless
   * the panel opens itself first.
   */
  useExpandCallsSignal(() => {
    setCollapsed((c) => {
      if (!c) return c;
      localStorage.setItem(STORAGE_KEY, "0");
      return false;
    });
    setShut((s) => {
      if (!s.includes("calls")) return s;
      const next = s.filter((x) => x !== "calls");
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  });

  function toggleSection(id: string) {
    setShut((s) => {
      const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  /*
   * Dragging the edge.
   *
   * Measured from the right of the window rather than from a start offset, so
   * the edge tracks the pointer exactly instead of drifting when the pointer
   * outruns a re-render. Listeners go on the window, not the handle, because a
   * fast drag leaves the four-pixel strip immediately.
   */
  const drag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);

    const move = (ev: PointerEvent) => {
      // Rounded: a pointer position can be fractional, and a stored width of
      // 439.9998779296875 is a thing somebody reads once and wonders about.
      const next = Math.round(
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX))
      );
      setWidth(next);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Read back off the element rather than closing over a stale value.
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  return (
    <aside
      style={collapsed ? undefined : { width }}
      className={`relative flex shrink-0 flex-col overflow-y-auto border-l bg-card/50 ${
        collapsed ? "w-14" : ""
      } ${dragging ? "" : "transition-[width] duration-200"}`}
    >
      {/*
        The drag handle: a thin strip on the left edge, widened by its own
        hit area rather than by taking up room. Hidden while collapsed, where
        there is nothing to size.
      */}
      {!collapsed && (
        <div
          onPointerDown={drag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/30 ${
            dragging ? "bg-primary/40" : ""
          }`}
        />
      )}

      <div className={`flex items-center gap-2 border-b px-4 py-3 ${collapsed ? "justify-center px-2" : ""}`}>
        {!collapsed && <span className="text-sm font-semibold">Work</span>}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          title={collapsed ? "Expand panel" : "Collapse panel"}
          aria-label={collapsed ? "Expand panel" : "Collapse panel"}
          className={collapsed ? "px-2" : "ml-auto px-2"}
        >
          {collapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        </Button>
      </div>

      {showCalls && (
        <div>
          <SectionHeader
            icon={<Phone className="h-4 w-4 shrink-0 text-muted-foreground" />}
            label="Calls"
            collapsed={collapsed}
            shut={callsShut}
            // Nothing to press mid-call: the section cannot be folded away, so
            // a control that looks like it would is worse than none.
            onToggle={onCall ? undefined : () => toggleSection("calls")}
            badge={onCall ? <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="On a call" /> : null}
          />
          {!collapsed && !callsShut && (
            <div>
              {/* Dialpad first: it's the provider that's actually cleared for
                  outbound calling. Telnyx and Twilio stay wired up underneath
                  in case that changes. */}
              {dialpadConfigured ? (
                <DialWidget />
              ) : telnyxConfigured ? (
                <TelnyxDialWidget />
              ) : twilioConfigured ? (
                <TwilioDialWidget />
              ) : (
                <DialWidget />
              )}
            </div>
          )}
        </div>
      )}

      {work.length > 0 && (
        <div>
          <SectionHeader
            icon={<ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />}
            label="ClickUp"
            collapsed={collapsed}
            shut={shut.includes("clickup")}
            onToggle={() => toggleSection("clickup")}
            badge={
              <span className="text-xs tabular-nums text-muted-foreground">{work.length}</span>
            }
          />
          {!shut.includes("clickup") && <RailWork items={work} collapsed={collapsed} />}
        </div>
      )}

      <div className={`mt-auto border-t p-3 ${collapsed ? "px-2" : ""}`}>
        <GaibWidget collapsed={collapsed} />
      </div>
    </aside>
  );
}

function SectionHeader({
  icon, label, collapsed, shut, onToggle, badge,
}: {
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  shut: boolean;
  /** Absent when the section is not allowed to fold right now. */
  onToggle?: () => void;
  badge?: React.ReactNode;
}) {
  const row = (
    <>
      {!collapsed && onToggle && (
        shut
          ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      {icon}
      {!collapsed && (
        <>
          <span className="text-sm font-semibold">{label}</span>
          {badge && <span className="ml-auto flex items-center">{badge}</span>}
        </>
      )}
    </>
  );

  const shape = `flex w-full items-center gap-2 border-b px-4 py-3 ${
    collapsed ? "justify-center px-2" : ""
  }`;

  // Collapsed to icons there is no header to click, and mid-call there is
  // nothing to be done -- a plain row in both cases rather than a dead button.
  if (collapsed || !onToggle) return <div className={shape}>{row}</div>;

  return (
    <button type="button" onClick={onToggle} aria-expanded={!shut} className={`${shape} hover:bg-accent/50`}>
      {row}
    </button>
  );
}
