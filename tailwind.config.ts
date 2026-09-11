import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    /*
     * lib too. Tailwind only generates a class it has literally seen, so a
     * class name living in a shared constant here -- lib/field-class.ts -- was
     * silently dropped from the stylesheet, and both sequence builders lost
     * their tinted fields with no error anywhere to say why.
     */
    "./lib/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "var(--font-body)", "sans-serif"],
      },
      colors: {
        /* Board columns. See --lane in globals.css. */
        lane: "hsl(var(--lane))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        field: "hsl(var(--field))",
        elevated: "hsl(var(--elevated))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          hover: "hsl(var(--card-hover))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      /*
       * The four slots below were missing, and the pattern was exact: every
       * value with a token stayed consistent across the app, and every value
       * without one drifted. Colour had tokens and is uniform; shadow,
       * spacing, type scale and motion had none, and those are the four areas
       * that fell apart -- 8 page-title treatments, three competing section
       * paddings, 27 unusable shadows, no motion at all.
       *
       * All four are ADDITIVE on purpose. Redefining Tailwind's own `spacing`
       * or `fontSize` scales would silently resize every one of the 110 pages
       * at once; adding names beside them lets new work be correct and old
       * work be moved over a screen at a time.
       *
       * Each name says what it is for rather than how big it is. `p-card`
       * cannot drift into meaning something else the way `p-4` did, and when
       * the decision changes it changes here -- once -- instead of in 41
       * files.
       */
      boxShadow: {
        raised: "var(--shadow-raised)",
        overlay: "var(--shadow-overlay)",
        modal: "var(--shadow-modal)",
      },
      fontSize: {
        /* 20px/600 -- the treatment already on 28 pages, made the one answer. */
        "page-title": ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600", letterSpacing: "-0.01em" }],
        "section-title": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.5rem" }],
        /* Secondary text and table figures. 523 uses of text-xs say this is
           the app's real second size, so it gets a name. */
        meta: ["0.75rem", { lineHeight: "1rem" }],
      },
      spacing: {
        /* Page gutter (p-6, 80 uses) and the card recipe (p-4, 41 uses). */
        section: "1.5rem",
        /* 24px, chosen 2026-09-10 -- up from the 16px the card recipe used. */
        card: "1.5rem",
        "card-tight": "0.75rem",
        /* Table density, in one place. Change these two and every list in the
           app changes with them -- which is the whole point of naming them. */
        "cell-x": "0.75rem",
        "cell-y": "0.5rem",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  // Without this, every `prose` class in the app is inert and Tailwind's own
  // reset leaves bullets and indentation stripped off lists -- the toolbar
  // buttons work, the lists just come out looking like plain paragraphs.
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
