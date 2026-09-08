export const metadata = { title: "Privacy — Factur" };

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Privacy</h1>
      <p className="text-muted-foreground">Last updated 8 September 2026</p>

      <p>
        This describes what the Factur team application and the Gaib assistant collect
        about Factur staff, and who can see it. It covers internal use only; it is not a
        notice to customers or the public.
      </p>

      <h2 className="pt-4 font-medium">What is collected</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your name, work email address and role, from your Factur Google account.</li>
        <li>What you do in the application — pages opened, records changed, work logged.</li>
        <li>
          Everything you say to Gaib, in the app or in Google Chat, together with its
          replies. Conversations are kept so they can be resumed and so reported problems
          can be traced back to what was actually said.
        </li>
      </ul>

      <h2 className="pt-4 font-medium">What Gaib can read on your behalf</h2>
      <p>
        When you ask a question that needs it, Gaib reads Factur records — clients,
        invoices, tickets — as you, so it can only reach what your own permissions allow.
        Where you have asked it to, it can also search your Factur mailbox, Chat and Drive
        for the specific question you asked. It does this in the moment, for that answer,
        and does not copy your mail or files into its own store.
      </p>

      <h2 className="pt-4 font-medium">Who can see your conversations</h2>
      <p>
        Your conversations with Gaib are visible to you and to Factur staff holding the
        transcripts permission, which today is the CEO. They are used to fix problems with
        the assistant and to act on what people report. They are not used to assess
        performance.
      </p>

      <h2 className="pt-4 font-medium">Where it goes</h2>
      <p>
        Data is held in Factur&apos;s Supabase database and hosted by Vercel. Messages you
        send to Gaib are processed by Anthropic to generate a reply. Google Workspace holds
        the mail, Chat and Drive that Gaib reads on request. Nothing is sold, and nothing is
        shared with anyone else.
      </p>

      <h2 className="pt-4 font-medium">How long it is kept</h2>
      <p>
        Conversations and activity records are kept while they are useful and are removed on
        request unless there is a business reason to keep them.
      </p>

      <h2 className="pt-4 font-medium">Asking for your data, or its removal</h2>
      <p>
        Write to <a className="underline" href="mailto:gabe@bethefactur.com">gabe@bethefactur.com</a>.
      </p>
    </>
  );
}
