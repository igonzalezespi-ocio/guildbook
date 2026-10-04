import clsx from "clsx";

export type OpenPriority = "low" | "medium" | "high";

const PRIORITY_ICON: Record<OpenPriority, { label: string; color: string; paths: string[] }> = {
  high: { label: "Prioridad alta", color: "#ef5358", paths: ["M3.5 8.5 8 4l4.5 4.5", "M3.5 12.5 8 8l4.5 4.5"] },
  medium: { label: "Prioridad media", color: "#f5a524", paths: ["M3 6h10", "M3 10h10"] },
  low: { label: "Prioridad baja", color: "#4c8ff7", paths: ["M3.5 3.5 8 8l4.5-4.5", "M3.5 7.5 8 12l4.5-4.5"] },
};

/** Jira-style recruitment priority: red up chevrons, amber double line, blue down chevrons. */
export function PriorityIcon({ priority, size = 16, className }: { priority: OpenPriority; size?: number; className?: string }) {
  const { label, color, paths } = PRIORITY_ICON[priority];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={clsx("inline-block shrink-0", className)}
    >
      <title>{label}</title>
      {paths.map((d) => (
        <path key={d} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function isOpenPriority(p: string): p is OpenPriority {
  return p in PRIORITY_ICON;
}
