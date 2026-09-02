"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, NotConnected, Chip } from "@/components/pipeline/bits";
import { CallDispositionDialog } from "@/components/pipeline/CallDispositionDialog";
import { claimOutboundNumber, getTwilioVoiceToken } from "@/actions/dialer";

/*
 * Click-to-dial via Twilio's Voice SDK -- Plan B while the Dialpad Mini
 * Dialer's Client ID is still pending. Genuinely different mechanism from
 * DialWidget: this isn't posting a message into someone else's iframe, it's
 * a real WebRTC call held by the browser itself, authenticated with a
 * short-lived token this app issues (getTwilioVoiceToken). The dial-out
 * itself happens when Twilio's servers hit app/api/twilio/voice with the
 * phone number and rotated caller ID passed through device.connect(params).
 *
 * Call/Device types come from @twilio/voice-sdk but are loaded dynamically
 * (see the import inside the effect) -- it touches WebRTC/AudioContext at
 * module load in a way that doesn't tolerate SSR.
 */

type CallState = "idle" | "dialing" | "ringing" | "ended";

export function TwilioDialWidget({
  opportunityId, phoneNumber, contactName, canAdmin,
}: {
  opportunityId: string;
  phoneNumber: string | null;
  contactName: string;
  canAdmin: boolean;
}) {
  const deviceRef = useRef<import("@twilio/voice-sdk").Device | null>(null);
  const callRef = useRef<import("@twilio/voice-sdk").Call | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [claiming, setClaiming] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const token = await getTwilioVoiceToken();
      if (!token) { if (!cancelled) setUnavailable(true); return; }

      const { Device } = await import("@twilio/voice-sdk");
      const device = new Device(token, { logLevel: "warn" });

      device.on("registered", () => { if (!cancelled) setReady(true); });
      device.on("error", (e) => { if (!cancelled) setError(e.message ?? "Twilio device error."); });
      device.on("tokenWillExpire", async () => {
        const fresh = await getTwilioVoiceToken();
        if (fresh) device.updateToken(fresh);
      });

      deviceRef.current = device;
      await device.register();
    }

    init().catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not start the dialer."); });

    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, []);

  async function placeCall() {
    if (!phoneNumber) { setError("This contact has no phone number on file."); return; }
    const device = deviceRef.current;
    if (!device) return;

    setError(null);
    setClaiming(true);
    try {
      const outboundCallerId = await claimOutboundNumber("twilio");
      if (!outboundCallerId) {
        setError("No active outbound numbers in the pool — add one in Dialer settings.");
        return;
      }
      setCallState("dialing");
      const call = await device.connect({
        params: { To: phoneNumber, CallerId: outboundCallerId, OpportunityId: opportunityId },
      });
      callRef.current = call;
      call.on("accept", () => setCallState("ringing"));
      call.on("disconnect", () => { setCallState("ended"); setDispositionOpen(true); });
      call.on("cancel", () => { setCallState("ended"); setDispositionOpen(true); });
      call.on("error", (e) => setError(e.message ?? "Call error."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place that call.");
      setCallState("idle");
    } finally {
      setClaiming(false);
    }
  }

  function hangUp() {
    callRef.current?.disconnect();
  }

  if (unavailable) {
    return (
      <NotConnected
        name="Dialer (Twilio)"
        requires="Needs TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID and TWILIO_AUTH_TOKEN set."
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
        ) : ready ? (
          <Chip colour="emerald">Ready</Chip>
        ) : (
          <Chip colour="amber">Connecting…</Chip>
        )
      }
    >
      <div className="space-y-3 p-4">
        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          {callState === "ringing" || callState === "dialing" ? (
            <Button variant="destructive" size="sm" onClick={hangUp} className="gap-2">
              <PhoneOff className="h-4 w-4" /> Hang up
            </Button>
          ) : (
            <Button size="sm" onClick={placeCall} disabled={!ready || claiming || !phoneNumber} className="gap-2">
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              Call {contactName}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setCallState("idle"); setDispositionOpen(true); }}>
            Log a call
          </Button>
          {!phoneNumber && <span className="text-xs text-muted-foreground">No phone on file</span>}
        </div>
      </div>

      <CallDispositionDialog
        open={dispositionOpen}
        onOpenChange={setDispositionOpen}
        opportunityId={opportunityId}
        contactName={contactName}
        onSaved={() => setCallState("idle")}
      />
    </Panel>
  );
}
