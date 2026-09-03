"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, NotConnected, Chip, Empty } from "@/components/pipeline/bits";
import { CallDispositionDialog } from "@/components/pipeline/CallDispositionDialog";
import { claimOutboundNumber } from "@/actions/dialer";
import { useCallTarget } from "@/components/work-panel/dialer-context";

/*
 * Click-to-dial, embedded.
 *
 * Dialpad's Mini Dialer is an iframe hosted on dialpad.com -- there is no
 * server-side call API involved here. "Dialing" means posting an
 * initiate_call message into that iframe once it has authenticated; the
 * iframe does the rest using whoever is logged into it. That's also why
 * outbound_caller_id (the rotated number) is picked *before* the message is
 * sent, from our own pool via claimOutboundNumber(), rather than anything
 * Dialpad decides.
 *
 * Lives in the work panel, not on the Opportunity page -- see
 * TelnyxDialWidget for why (useCallTarget instead of props is what lets the
 * iframe and an in-progress call survive navigation).
 *
 * Message shape is Dialpad's `opencti_dialpad` protocol -- see
 * developers.dialpad.com/docs/dialpad-mini-dialer. call_ringing firing with
 * state "off" after it fired "on" is read as "the call ended," which opens
 * the disposition dialog. That signal is inferred from a docs example, not
 * verified against a live call, so "Log a call" also exists as a way to
 * disposition by hand if the ended-detection turns out to be unreliable.
 */

const DIALPAD_ORIGIN = "https://dialpad.com";
const CTI_CLIENT_ID = process.env.NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID || null;

type CallState = "idle" | "dialing" | "ringing" | "ended";

function postToDialer(frame: HTMLIFrameElement | null, method: string, payload: Record<string, unknown> = {}) {
  frame?.contentWindow?.postMessage(
    { api: "opencti_dialpad", version: "1.0", method, payload },
    DIALPAD_ORIGIN
  );
}

export function DialWidget() {
  const { target, canAdmin, commit, release } = useCallTarget();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [claiming, setClaiming] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CTI_CLIENT_ID) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== DIALPAD_ORIGIN) return;
      const msg = event.data as { api?: string; method?: string; payload?: Record<string, unknown> };
      if (msg?.api !== "opencti_dialpad") return;

      if (msg.method === "user_authentication") {
        setAuthenticated(Boolean(msg.payload?.user_authenticated));
      }
      if (msg.method === "call_ringing") {
        const on = msg.payload?.state === "on";
        setCallState((prev) => {
          if (on) return "ringing";
          if (prev === "ringing" || prev === "dialing") {
            setDispositionOpen(true);
            return "ended";
          }
          return prev;
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function placeCall() {
    if (!target?.phoneNumber) {
      setError("This contact has no phone number on file.");
      return;
    }
    setError(null);
    setClaiming(true);
    try {
      const claimed = await claimOutboundNumber("dialpad");
      if (!claimed.ok) {
        setError(claimed.error);
        return;
      }
      const outboundCallerId = claimed.e164;
      if (!outboundCallerId) {
        setError("No active outbound numbers in the pool — add one in Dialer settings.");
        return;
      }
      commit();
      setCallState("dialing");
      postToDialer(frameRef.current, "initiate_call", {
        phone_number: target.phoneNumber,
        outbound_caller_id: outboundCallerId,
        custom_data: JSON.stringify({ opportunity_id: target.opportunityId }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place that call.");
    } finally {
      setClaiming(false);
    }
  }

  function hangUp() {
    postToDialer(frameRef.current, "hang_up_all_calls");
    setDispositionOpen(true);
    setCallState("ended");
  }

  if (!CTI_CLIENT_ID) {
    return (
      <NotConnected
        name="Dialpad"
        requires="Needs the CTI Client ID Dialpad issues once the Mini Dialer integration is set up on their side — set NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID once you have it."
        canAdmin={canAdmin}
      />
    );
  }

  return (
    <Panel
      title="Dialer"
      action={
        callState === "ringing" || callState === "dialing" ? (
          <Chip colour="emerald">{callState === "dialing" ? "Dialing…" : "In call"}</Chip>
        ) : authenticated ? (
          <Chip colour="emerald">Connected</Chip>
        ) : (
          <Chip colour="amber">Sign in below</Chip>
        )
      }
    >
      <div className="space-y-3 p-4">
        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {!target ? (
          <Empty>Open an Opportunity to call.</Empty>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-full truncate text-sm font-medium">{target.contactName}</span>
            {callState === "ringing" || callState === "dialing" ? (
              <Button variant="destructive" size="sm" onClick={hangUp} className="gap-2">
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={placeCall}
                disabled={!authenticated || claiming || !target.phoneNumber}
                className="gap-2"
              >
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Call
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setCallState("idle"); setDispositionOpen(true); }}
            >
              Log a call
            </Button>
            {!target.phoneNumber && <span className="text-xs text-muted-foreground">No phone on file</span>}
          </div>
        )}

        <iframe
          ref={frameRef}
          src={`${DIALPAD_ORIGIN}/apps/${CTI_CLIENT_ID}`}
          title="Dialpad"
          className="h-[420px] w-full rounded-md border"
          allow="microphone; speaker-selection; autoplay; camera; display-capture; hid"
          sandbox="allow-popups allow-scripts allow-same-origin allow-forms"
        />
      </div>

      {target && (
        <CallDispositionDialog
          open={dispositionOpen}
          onOpenChange={setDispositionOpen}
          opportunityId={target.opportunityId}
          contactName={target.contactName}
          onSaved={() => { setCallState("idle"); release(); }}
        />
      )}
    </Panel>
  );
}
