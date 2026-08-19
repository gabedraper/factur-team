export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-xl font-semibold">Not a Factur account</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This site is only available to @bethefactur.com and @facturmfg.com
        accounts. Sign out of your other Google account and try again.
      </p>
      <a className="text-sm underline" href="/login">
        Back to sign in
      </a>
    </div>
  );
}
