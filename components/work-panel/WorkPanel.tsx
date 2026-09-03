"use client";

import { useEffect, useState } from "react";
import { Phone, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialWidget } from "@/components/pipeline/DialWidget";
import { TwilioDialWidget } from "@/components/pipeline/TwilioDialWidget";
import { TelnyxDialWidget } from "@/components/pipeline/TelnyxDialWidget";
import { GaibWidget } from "@/components/gaib/gaib-widget";

const STORAGE_KEY = "factur-work-panel-collapsed";

/**
 * The persistent right rail -- left is navigation, this is work: whatever a
 * rep is actively doing, regardless of which page they're looking at.
 * Calls today; ClickUp tasks and whatever comes next go here as their own
 * sections later, same pattern as this one. Gaib lives here too, pinned to
 * the bottom, rather than in the left sidebar -- the same reasoning as
 * everything else in this panel: it's work you reach for from any page.
 */
export function WorkPanel({
  showCalls, telnyxConfigured, twilioConfigured,
}: {
  showCalls: boolean;
  telnyxConfigured: boolean;
  twilioConfigured: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  return (
    <aside
      className={`${collapsed ? "w-14" : "w-96"} flex shrink-0 flex-col overflow-y-auto border-l bg-card/50 transition-[width] duration-200`}
    >
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
          <div className={`flex items-center gap-2 border-b px-4 py-3 ${collapsed ? "justify-center px-2" : ""}`}>
            <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
            {!collapsed && <span className="text-sm font-semibold">Calls</span>}
          </div>
          {!collapsed && (
            <div className="p-3">
              {telnyxConfigured ? (
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

      <div className={`mt-auto border-t p-3 ${collapsed ? "px-2" : ""}`}>
        <GaibWidget collapsed={collapsed} />
      </div>
    </aside>
  );
}
