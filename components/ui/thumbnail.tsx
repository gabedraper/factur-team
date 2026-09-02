"use client";

import { useState } from "react";

/**
 * Faces and logos, with something sensible when there is neither.
 *
 * Both fall back to initials on a tinted square rather than a grey silhouette.
 * A row of identical placeholder people is worse than no pictures at all --
 * it costs the same vertical space and tells you nothing, where initials at
 * least distinguish one row from the next.
 *
 * Plain <img> rather than next/image on purpose. These come from hosts we do
 * not control and cannot predict, and a missing logo has to fail quietly into
 * the fallback; routed through the image optimiser a 404 becomes an error
 * instead of an initial.
 */

/** Deterministic tint, so the same person is the same colour on every screen. */
function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  // Spread around the wheel, kept muted so a table of them is not a fruit bowl.
  return `hsl(${Math.abs(hash) % 360} 45% 42%)`;
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function Fallback({ label, size, rounded }: { label: string; size: number; rounded: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, backgroundColor: tintFor(label) }}
      className={`inline-flex shrink-0 items-center justify-center ${rounded} text-white`}
    >
      <span style={{ fontSize: Math.round(size * 0.38) }} className="font-medium leading-none">
        {initialsFor(label)}
      </span>
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = 28,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return <Fallback label={name} size={size} rounded="rounded-full" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}

/*
 * Where a company logo comes from.
 *
 * Clearbit's free logo API was the obvious answer for years and was shut down
 * in December 2025, so this uses Google's favicon service, which needs no
 * account and no key. Favicons are not logos -- they are small and often a
 * mark rather than a wordmark -- so if a token for a real logo service is
 * configured, that is used instead and everything gets sharper without any
 * other change.
 */
const FAVICON_SIZES = [16, 32, 64, 128, 256];

export function logoSrcFor(domain: string, size: number): string {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

  if (token) {
    return `https://img.logo.dev/${encodeURIComponent(clean)}?token=${token}&size=${size * 2}`;
  }

  // Google only serves a fixed set of sizes; asking for 56 silently gets 16.
  const px = FAVICON_SIZES.find((s) => s >= size * 2) ?? 256;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=${px}`;
}

export function CompanyLogo({
  name,
  domain,
  src,
  size = 24,
  className = "",
}: {
  name: string;
  /** The company's email or web domain. Without one there is nothing to ask for. */
  domain?: string | null;
  /*
   * A logo somebody has actually put on the record.
   *
   * Wins over the domain lookup: a chosen logo is a decision, and a guessed
   * favicon should never quietly override it.
   */
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const chosen = src || (domain ? logoSrcFor(domain, size) : null);

  if (!chosen || broken) {
    return <Fallback label={name} size={size} rounded="rounded-md" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={chosen}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-md bg-muted object-contain ${className}`}
    />
  );
}
