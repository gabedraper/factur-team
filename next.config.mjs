const nextConfig = {
  /*
   * Still under experimental in Next 16.3 -- it did NOT move out, whatever the
   * previous comment here said. At the top level Next rejects the key as
   * unrecognised (it says so in every Vercel build log) and silently falls
   * back to its 1 MB default, so every upload through a server action --
   * resumes, course material, signed agreements -- was capped at 1 MB rather
   * than 8. Checked against next/dist/server/config-shared.d.ts.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // @react-pdf/renderer ships "use client" in its entry points, so bundling it
  // makes the certificate document a client module and the server cannot call
  // it. Keeping it external leaves it as a plain server-side dependency -- this
  // is the modern replacement for the webpack `canvas`/`fs` fallbacks that the
  // Turbopack migration removed.
  serverExternalPackages: ["@react-pdf/renderer"],
  turbopack: {},
};

export default nextConfig;
