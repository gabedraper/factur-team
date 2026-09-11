export const metadata = { title: "Terms of use — Factur" };

export default function TermsPage() {
  return (
    <>
      {/* design-ok: public page outside the app shell */}
      <h1 className="text-xl font-semibold">Terms of use</h1>
      <p className="text-muted-foreground">Last updated 8 September 2026</p>

      <p>
        This application, including the Gaib assistant in Google Chat, is an internal
        tool operated by Factur for its own staff. It is not offered to the public and
        is not available outside the facturmfg.com and bethefactur.com domains.
      </p>

      <h2 className="pt-4 font-medium">Who may use it</h2>
      <p>
        Access is limited to current Factur personnel with a company Google account.
        Access ends when employment or engagement ends.
      </p>

      <h2 className="pt-4 font-medium">Acceptable use</h2>
      <p>
        Use the application for Factur business. Do not share what you see in it outside
        Factur, do not attempt to reach data you are not permitted to see, and do not use
        it to store personal material.
      </p>

      <h2 className="pt-4 font-medium">The assistant&apos;s answers</h2>
      <p>
        Gaib answers from Factur&apos;s own records using a language model, and language
        models can be wrong. Treat its answers as a starting point rather than as a
        record of fact, and check anything you are about to act on.
      </p>

      <h2 className="pt-4 font-medium">Availability</h2>
      <p>
        The application is provided as it is, without a service commitment. Factur may
        change, suspend or withdraw it, in whole or in part, at any time.
      </p>

      <h2 className="pt-4 font-medium">Questions</h2>
      <p>
        Write to <a className="underline" href="mailto:gabe@bethefactur.com">gabe@bethefactur.com</a>.
      </p>
    </>
  );
}
