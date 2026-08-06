import { stringHue } from "../lib/utils";

export function Avatar({ name, size = 24 }: { name: string; size?: number }): JSX.Element {
  const h = stringHue(name);
  const initials = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span
      className="inline-grid place-items-center rounded-full font-semibold text-[10px] text-white shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 60% 45%))`
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
