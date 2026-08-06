/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          0: "rgb(var(--bg-0) / <alpha-value>)",
          1: "rgb(var(--bg-1) / <alpha-value>)",
          2: "rgb(var(--bg-2) / <alpha-value>)",
          3: "rgb(var(--bg-3) / <alpha-value>)"
        },
        line: "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)"
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)"
        },
        sev: {
          clean: "rgb(var(--sev-clean) / <alpha-value>)",
          low: "rgb(var(--sev-low) / <alpha-value>)",
          medium: "rgb(var(--sev-medium) / <alpha-value>)",
          high: "rgb(var(--sev-high) / <alpha-value>)",
          critical: "rgb(var(--sev-critical) / <alpha-value>)"
        }
      },
      fontFamily: {
        sans: [
          "InterVariable",
          "Inter",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif"
        ],
        display: [
          "Geist",
          "InterVariable",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ],
        mono: [
          "JetBrains Mono",
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace"
        ]
      },
      letterSpacing: {
        tightest: "-0.03em",
        telemetry: "0.14em"
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" }
        },
        drift: {
          "0%,100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,-6px,0)" }
        },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--accent) / 0.5)" },
          "70%": { boxShadow: "0 0 0 8px rgb(var(--accent) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--accent) / 0)" }
        }
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        scan: "scan 2.2s linear infinite",
        drift: "drift 8s ease-in-out infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite"
      }
    }
  },
  plugins: []
};
