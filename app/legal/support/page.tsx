export const metadata = { title: "Support — Factur" };

export default function SupportPage() {
  return (
    <>
      {/* design-ok: public page outside the app shell */}
      <h1 className="text-xl font-semibold">Support</h1>

      <h2 className="pt-4 font-medium">Message Gaib</h2>
      <p>
        Open Gaib in Google Chat, or the assistant button in the team app, and say what is
        wrong. It writes the ticket, puts it in front of whoever needs to see it, and comes
        back to tell you when it is done.
      </p>

      <h2 className="pt-4 font-medium">Or write to a person</h2>
      <p>
        <a className="underline" href="mailto:gabe@bethefactur.com">gabe@bethefactur.com</a>
      </p>

      <h2 className="pt-4 font-medium">If you cannot sign in</h2>
      <p>
        Sign in with your Factur Google account. If that account works elsewhere and not
        here, email the address above — the assistant cannot help while you are locked out.
      </p>
    </>
  );
}
