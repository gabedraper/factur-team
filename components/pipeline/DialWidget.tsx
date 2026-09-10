"use client";

import { useEffect, useRef, useState } from "react";
import { setCallActive } from "@/lib/calls/active";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, NotConnected, Chip, Empty } from "@/components/pipeline/bits";
import { CallDispositionDialog } from "@/components/pipeline/CallDispositionDialog";
import { claimOutboundNumber } from "@/actions/dialer";
import { useCallTarget } from "@/components/work-panel/dialer-context";
import { toE164 } from "@/lib/phone";

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
  const { target, canAdmin, commit, release, requestedCall, clearRequestedCall } = useCallTarget();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [claiming, setClaiming] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Say so, for the right rail. It refuses to fold the Calls section away
   * while this is true -- collapsing the panel out from under somebody who is
   * mid-call is the one thing it must never do.
   *
   * Clearing it is its own effect, running only on unmount. Returned from the
   * one above it would fire on every change of state, setting the flag false
   * and true again in the same tick -- and a listener that saw the false would
   * fold the section away underneath a live call.
   */
  useEffect(() => {
    setCallActive(callState === "dialing" || callState === "ringing");
  }, [callState]);
  useEffect(() => () => setCallActive(false), []);

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

  useEffect(() => {
    if (!requestedCall) return;
    void placeCall(requestedCall);
    clearRequestedCall();
    // placeCall/clearRequestedCall close over this render's state, which is
    // what we want -- only requestedCall itself should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedCall]);

  /**
   * overrideNumber comes from something outside this panel asking to dial a
   * specific number -- a target account's contact, e.g. -- which may well
   * have no Opportunity open at all (Target Companies isn't an Opportunity
   * page). Only commit()/tag the call with an opportunity_id when this is
   * the normal, no-override path calling this Opportunity's own contact --
   * an ad hoc number is unrelated to whatever happens to be open elsewhere,
   * and must not be misattributed to it.
   */
  async function placeCall(overrideNumber?: string) {
    const raw = overrideNumber ?? target?.phoneNumber;
    if (!raw) {
      setError(target ? "This contact has no phone number on file." : "Open an Opportunity to call.");
      return;
    }
    // crm_contacts.phone comes out of Salesforce in whatever shape it was
    // typed in over the years -- Dialpad's initiate_call silently does
    // nothing if this isn't clean E.164, which read as "click to dial is
    // broken" rather than "this contact's number is malformed."
    const phoneNumber = toE164(raw);
    if (!phoneNumber) {
      setError(`This contact's phone number doesn't look valid: "${raw}".`);
      return;
    }
    setError(null);
    setClaiming(true);
    try {
      // Unlike Telnyx/Twilio, Dialpad already manages its own outbound
      // caller ID -- the number/identity picker built into the Mini Dialer
      // itself (visible at the top of the embed). There's nothing to
      // require from our own pool here; claim one if it happens to exist
      // (so the pool's usage stats stay meaningful) but don't block the
      // call on it.
      const claimed = await claimOutboundNumber("dialpad");
      const outboundCallerId = claimed.ok ? claimed.e164 : null;
      const isAdHoc = Boolean(overrideNumber);
      if (!isAdHoc) commit();
      setCallState("dialing");
      postToDialer(frameRef.current, "initiate_call", {
        phone_number: phoneNumber,
        ...(outboundCallerId ? { outbound_caller_id: outboundCallerId } : {}),
        ...(isAdHoc ? {} : { custom_data: JSON.stringify({ opportunity_id: target!.opportunityId }) }),
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
      <div className="space-y-3">
        {error && (
          <p className="mx-3 mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {!target ? (
          <Empty>Open an Opportunity to call.</Empty>
        ) : (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
            <span className="w-full truncate text-sm font-medium">{target.contactName}</span>
            {callState === "ringing" || callState === "dialing" ? (
              <Button variant="destructive" size="sm" onClick={hangUp} className="gap-2">
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => placeCall()}
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

        {/* 400x520 is Dialpad's own documented size for this embed --
            developers.dialpad.com/docs/dialpad-mini-dialer -- but that's a
            floor, not a target: no horizontal margin here, so it fills
            whatever the panel gives it instead of sitting on a slab of empty
            space either side. */}
        <iframe
          ref={frameRef}
          src={`${DIALPAD_ORIGIN}/apps/${CTI_CLIENT_ID}`}
          title="Dialpad"
          className="h-[520px] w-full"
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
