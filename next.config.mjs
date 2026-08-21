const nextConfig = {
  // Next 16 moved serverActions out of experimental.
  serverActions: {
    bodySizeLimit: "8mb",
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
