"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel, NotConnected, Chip, Empty } from "@/components/pipeline/bits";
import { Keypad } from "@/components/pipeline/Keypad";
import { CallDispositionDialog } from "@/components/pipeline/CallDispositionDialog";
import { claimOutboundNumber, getTelnyxVoiceToken, sendSms } from "@/actions/dialer";
import { useCallTarget } from "@/components/work-panel/dialer-context";

/*
 * Click-to-dial via Telnyx's WebRTC SDK -- Plan C. Twilio's own signup
 * couldn't deliver a 2FA verification code after repeated tries, so this
 * exists alongside TwilioDialWidget/DialWidget rather than replacing either;
 * whichever provider actually has credentials wins, decided server-side and
 * passed down from WorkPanel.
 *
 * Lives in the work panel now, not on the Opportunity page -- who it's
 * calling comes from useCallTarget() (the opportunity currently open, or
 * whoever a call is already committed to) rather than props, which is what
 * lets the connection and an in-progress call survive navigating away from
 * the page that started it.
 *
 * State comes through TelnyxRTC's single `telnyx.notification` event bus,
 * not discrete per-call events like Twilio's Call object -- every call
 * update (ringing, active, hangup, ...) arrives as one notification with
 * type "callUpdate" and the current Call on it, so state is read off
 * notification.call.state rather than listening on the call itself.
 */

type CallState = "idle" | "dialing" | "ringing" | "ended";

export function TelnyxDialWidget() {
  const { target, canAdmin, commit, release } = useCallTarget();
  const clientRef = useRef<InstanceType<typeof import("@telnyx/webrtc").TelnyxRTC> | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [claiming, setClaiming] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A call the keypad below placed, to an arbitrary number rather than the
  // Opportunity currently open -- it isn't attached to a CRM record, so it
  // skips commit()/the disposition dialog entirely. adHocRef (not state)
  // because the notification handler below is wired up once and would
  // otherwise read a stale value.
  const [manualNumber, setManualNumber] = useState("");
  const [dialedNumber, setDialedNumber] = useState<string | null>(null);
  const adHocRef = useRef(false);
  const [texting, setTexting] = useState(false);
  const [smsBody, setSmsBody] = useState("");
  const [sendingSms, setSendingSms] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

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
      client.on(
        "telnyx.notification",
        (notification: { type: string; call?: { state: string; cause?: string; causeCode?: number } }) => {
          if (cancelled || notification.type !== "callUpdate" || !notification.call) return;
          const { state, cause } = notification.call;
          if (state === "ringing" || state === "active" || state === "trying" || state === "early") {
            setCallState("ringing");
          } else if (state === "hangup" || state === "destroy") {
            setCallState((prev) => {
              if (prev === "idle") return prev;
              // A cause other than a normal clearing means the far end never
              // actually rang -- e.g. Telnyx declining the call outright
              // (SIP 603) while the account is still Pretrial. Surface it
              // instead of silently dropping into "how'd the call go?".
              if (cause && cause !== "NORMAL_CLEARING" && cause !== "ORIGINATOR_CANCEL") {
                setError(`Call did not connect: ${cause.replaceAll("_", " ").toLowerCase()}.`);
              }
              if (adHocRef.current) {
                adHocRef.current = false;
                setDialedNumber(null);
                return "idle";
              }
              setDispositionOpen(true);
              return "ended";
            });
          }
        }
      );

      clientRef.current = client;
      client.connect();
    }

    // Connects once, regardless of which opportunity (if any) is open --
    // this panel is always mounted, so the SDK session shouldn't churn every
    // time a rep navigates.
    init().catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not start the dialer."); });

    return () => {
      cancelled = true;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  /** overrideNumber comes from the keypad; omitted, this calls the Opportunity's own contact. */
  async function placeCall(overrideNumber?: string) {
    const number = overrideNumber ?? target?.phoneNumber;
    if (!number) { setError("This contact has no phone number on file."); return; }
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
      adHocRef.current = Boolean(overrideNumber);
      if (adHocRef.current) {
        setDialedNumber(number);
      } else {
        commit();
      }
      setCallState("dialing");
      client.newCall({
        destinationNumber: number,
        callerNumber: outboundCallerId,
        ...(adHocRef.current ? {} : { customHeaders: [{ name: "X-Opportunity-Id", value: target!.opportunityId }] }),
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

  async function sendText() {
    const to = manualNumber.trim();
    const text = smsBody.trim();
    if (!to || !text) return;

    setError(null);
    setSmsSent(false);
    setSendingSms(true);
    try {
      await sendSms(to, text);
      setSmsSent(true);
      setSmsBody("");
      setTimeout(() => setSmsSent(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that text.");
    } finally {
      setSendingSms(false);
    }
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
              <Button size="sm" onClick={() => placeCall()} disabled={!ready || claiming || !target.phoneNumber} className="gap-2">
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Call
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setCallState("idle"); setDispositionOpen(true); }}>
              Log a call
            </Button>
            {!target.phoneNumber && <span className="text-xs text-muted-foreground">No phone on file</span>}
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            {dialedNumber ? `Calling ${dialedNumber}` : "Dial a number"}
          </p>
          <Input
            type="tel"
            value={manualNumber}
            onChange={(e) => setManualNumber(e.target.value)}
            placeholder="(555) 867-5309"
            className="tabular-nums"
          />
          <Keypad onPress={(d) => setManualNumber((n) => n + d)} />
          <div className="flex gap-2">
            {callState === "ringing" || callState === "dialing" ? (
              <Button variant="destructive" size="sm" onClick={hangUp} className="flex-1 gap-2">
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => placeCall(manualNumber.trim())}
                disabled={!ready || claiming || !manualNumber.trim()}
                className="flex-1 gap-2"
              >
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Call
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTexting((t) => !t)}
              disabled={!manualNumber.trim()}
              className="flex-1 gap-2"
            >
              <MessageSquareText className="h-4 w-4" /> Text
            </Button>
          </div>

          {texting && (
            <div className="space-y-2 rounded-md border p-2">
              <Textarea
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Message"
                rows={2}
                className="min-h-0 resize-none text-sm"
              />
              <div className="flex items-center justify-end gap-2">
                {smsSent && <span className="mr-auto text-xs text-emerald-600">Sent.</span>}
                <Button variant="ghost" size="sm" onClick={() => { setTexting(false); setSmsBody(""); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={sendText} disabled={sendingSms || !smsBody.trim()}>
                  {sendingSms ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
          )}
        </div>
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
