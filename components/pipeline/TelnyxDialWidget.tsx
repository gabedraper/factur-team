"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, NotConnected, Chip } from "@/components/pipeline/bits";
import { CallDispositionDialog } from "@/components/pipeline/CallDispositionDialog";
import { claimOutboundNumber, getTelnyxVoiceToken } from "@/actions/dialer";

/*
 * Click-to-dial via Telnyx's WebRTC SDK -- Plan C. Twilio's own signup
 * couldn't deliver a 2FA verification code after repeated tries, so this
 * exists alongside TwilioDialWidget/DialWidget rather than replacing either;
 * whichever provider actually has credentials wins, decided server-side on
 * the Opportunity page.
 *
 * State comes through TelnyxRTC's single `telnyx.notification` event bus,
 * not discrete per-call events like Twilio's Call object -- every call
 * update (ringing, active, hangup, ...) arrives as one notification with
 * type "callUpdate" and the current Call on it, so state is read off
 * notification.call.state rather than listening on the call itself.
 */

type CallState = "idle" | "dialing" | "ringing" | "ended";

export function TelnyxDialWidget({
  opportunityId, phoneNumber, contactName, canAdmin,
}: {
  opportunityId: string;
  phoneNumber: string | null;
  contactName: string;
  canAdmin: boolean;
}) {
  const clientRef = useRef<InstanceType<typeof import("@telnyx/webrtc").TelnyxRTC> | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [claiming, setClaiming] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const token = await getTelnyxVoiceToken();
      if (!token) { if (!cancelled) setUnavailable(true); return; }

      const { TelnyxRTC } = await import("@telnyx/webrtc");
      const client = new TelnyxRTC({ login_token: token });

      client.on("telnyx.ready", () => { if (!cancelled) setReady(true); });
      client.on("telnyx.error", (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Telnyx connection error.");
      });
      client.on("telnyx.notification", (notification: { type: string; call?: { state: string } }) => {
        if (cancelled || notification.type !== "callUpdate" || !notification.call) return;
        const state = notification.call.state;
        if (state === "ringing" || state === "active" || state === "trying" || state === "early") {
          setCallState("ringing");
        } else if (state === "hangup" || state === "destroy") {
          setCallState((prev) => {
            if (prev === "idle") return prev;
            setDispositionOpen(true);
            return "ended";
          });
        }
      });

      clientRef.current = client;
      client.connect();
    }

    init().catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not start the dialer."); });

    return () => {
      cancelled = true;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  async function placeCall() {
    if (!phoneNumber) { setError("This contact has no phone number on file."); return; }
    const client = clientRef.current;
    if (!client) return;

    setError(null);
    setClaiming(true);
    try {
      const outboundCallerId = await claimOutboundNumber("telnyx");
      if (!outboundCallerId) {
        setError("No active outbound numbers in the pool — add one in Dialer settings.");
        return;
      }
      setCallState("dialing");
      client.newCall({
        destinationNumber: phoneNumber,
        callerNumber: outboundCallerId,
        customHeaders: [{ name: "X-Opportunity-Id", value: opportunityId }],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place that call.");
      setCallState("idle");
    } finally {
      setClaiming(false);
    }
  }

  function hangUp() {
    clientRef.current?.getActiveCalls().forEach((c) => c.hangup());
  }

  if (unavailable) {
    return (
      <NotConnected
        name="Dialer (Telnyx)"
        requires="Needs TELNYX_API_KEY, TELNYX_CREDENTIAL_ID, TELNYX_PUBLIC_KEY set, and a TeXML Application pointed at app/api/telnyx/voice."
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
