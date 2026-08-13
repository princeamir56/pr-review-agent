import type { RiskLevel } from "./api";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.round((now - then) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export const RISK_TONE: Record<RiskLevel, string> = {
  clean: "text-sev-clean bg-sev-clean/10 border-sev-clean/30",
  low: "text-sev-low bg-sev-low/10 border-sev-low/30",
  medium: "text-sev-medium bg-sev-medium/10 border-sev-medium/30",
  high: "text-sev-high bg-sev-high/10 border-sev-high/30",
  critical: "text-sev-critical bg-sev-critical/10 border-sev-critical/40"
};

export function parseSeverityLine(md: string): { critical: number; high: number; medium: number; low: number } | null {
  const m = /\*\*Summary:\*\*\s*(\d+)\s*critical\s*·\s*(\d+)\s*high\s*·\s*(\d+)\s*medium\s*·\s*(\d+)\s*low/i.exec(md);
  if (!m) return null;
  return { critical: +m[1]!, high: +m[2]!, medium: +m[3]!, low: +m[4]! };
}

/** Deterministic pastel color derived from a string — used for author avatars. */
export function stringHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export interface TocEntry {
  level: 2 | 3;
  /** Heading text with any leading emoji stripped off. */
  text: string;
  /** The leading emoji, when the heading starts with one. */
  icon: string | null;
  slug: string;
}

/**
 * Extract a Markdown table of contents from `## Heading` lines.
 *
 * Fenced code blocks are skipped: reports quote changelog snippets that contain
 * their own `## [Unreleased]` headings, and those are sample content, not
 * sections. They also never get an id from rehype-slug (they render inside
 * `<pre>`), so listing them produced links that scrolled nowhere.
 */
export function extractToc(md: string): TocEntry[] {
  const out: TocEntry[] = [];
  let inFence = false;

  for (const raw of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m2 = /^##\s+(.+?)\s*$/.exec(raw);
    const m3 = /^###\s+(.+?)\s*$/.exec(raw);
    const match = m2 ?? m3;
    if (!match) continue;

    const text = match[1]!;
    // Slug must match rehype-slug, which sees the full text including emoji.
    const slug = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

    const emoji = /^(\p{Extended_Pictographic}(?:️)?)\s*/u.exec(text);
    out.push({
      level: m2 ? 2 : 3,
      text: emoji ? text.slice(emoji[0].length) : text,
      icon: emoji ? emoji[1]! : null,
      slug
    });
  }
  return out;
}
