import type { ReactNode } from "react";
import { resourceLabel } from "@/lib/vigil/format";
import type { FightReport } from "@/lib/vigil/report";

const WIDTH = 1000;
const ROW = 18;
const LABEL = 132;

type Row = { label: string; kind: "casts" | "idle" | "uptime" | "resource" };

/**
 * The fight on one strip: global cooldown casts (gold when they followed the priority, crimson when not),
 * idle time while something was ready, uptime bars and the resource line.
 */
export function FightTimeline({ report }: { report: FightReport }) {
  const duration = report.fight.durationMs;
  const x = (t: number) => LABEL + (Math.min(Math.max(t, 0), duration) / duration) * (WIDTH - LABEL - 8);
  const uptimes = report.uptimes.filter((u) => u.intervals.length > 0).slice(0, 5);
  const rows: Row[] = [
    { label: "Lanzamientos", kind: "casts" },
    { label: report.activity.readyIdleMs !== null ? "Inactivo con habilidad lista" : "Inactivo", kind: "idle" },
    ...uptimes.map((u): Row => ({ label: u.label, kind: "uptime" })),
    ...(report.resource ? [{ label: resourceLabel(report.resource.name), kind: "resource" } as Row] : []),
  ];
  const height = rows.length * (ROW + 8) + 22;
  const step = duration > 180_000 ? 30_000 : duration > 60_000 ? 15_000 : duration > 20_000 ? 5_000 : 2_000;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);
  const top = (i: number) => i * (ROW + 8) + 4;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Cronología de ${report.fight.label}`}
        data-testid="vigil-timeline"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={height - 18} stroke="var(--color-line)" strokeWidth={0.6} />
            <text x={x(t)} y={height - 4} fontSize={11} textAnchor="middle" fill="var(--color-muted)">
              {Math.round(t / 1000)} s
            </text>
          </g>
        ))}
        {rows.map((row, i) => {
          const y = top(i);
          return (
            <g key={`${row.kind}-${row.label}`}>
              <text x={0} y={y + ROW - 5} fontSize={12} fill="var(--color-muted)">
                {row.label.length > 20 ? `${row.label.slice(0, 19)}…` : row.label}
              </text>
              <rect x={LABEL} y={y} width={WIDTH - LABEL - 8} height={ROW} fill="var(--color-ink)" opacity={0.6} rx={2} />
              {row.kind === "casts" &&
                report.casts.map((c, j) => (
                  <rect
                    key={j}
                    x={x(c.t) - (c.gcd ? 1.5 : 0.75)}
                    y={c.gcd ? y + 1 : y + ROW / 2}
                    width={c.gcd ? 3 : 1.5}
                    height={c.gcd ? ROW - 2 : ROW / 2 - 1}
                    fill={
                      c.verdict === "miss"
                        ? "var(--color-crimson-bright)"
                        : c.verdict === "match"
                          ? "var(--color-gold-bright)"
                          : "var(--color-muted)"
                    }
                  >
                    <title>{`${(c.t / 1000).toFixed(1).replace(".", ",")} s ${c.name}${c.verdict === "miss" ? " (fuera de prioridad)" : ""}`}</title>
                  </rect>
                ))}
              {row.kind === "idle" &&
                report.activity.idleGaps.map(([a, b], j) => (
                  <rect key={j} x={x(a)} y={y + 2} width={Math.max(1, x(b) - x(a))} height={ROW - 4} fill="var(--color-crimson)" rx={2}>
                    <title>{`De ${(a / 1000).toFixed(1).replace(".", ",")} s a ${(b / 1000).toFixed(1).replace(".", ",")} s`}</title>
                  </rect>
                ))}
              {row.kind === "uptime" &&
                uptimes
                  .find((u) => u.label === row.label)!
                  .intervals.map(([a, b], j) => (
                    <rect key={j} x={x(a)} y={y + 3} width={Math.max(1, x(b) - x(a))} height={ROW - 6} fill="var(--color-gold-dim)" rx={2} />
                  ))}
              {row.kind === "resource" && report.resource && report.resource.max > 0 && (
                <polyline
                  fill="none"
                  stroke="var(--color-gold)"
                  strokeWidth={1.4}
                  points={report.resource.samples
                    .map(([t, v]) => `${x(t)},${y + ROW - 1 - (Math.min(v, report.resource!.max) / report.resource!.max) * (ROW - 2)}`)
                    .join(" ")}
                />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legend color="var(--color-gold-bright)">Según prioridad</Legend>
        <Legend color="var(--color-crimson-bright)">Fuera de prioridad</Legend>
        <Legend color="var(--color-muted)">Otros lanzamientos (las marcas cortas no usan el tiempo de reutilización global)</Legend>
        <Legend color="var(--color-crimson)">Inactivo</Legend>
      </figcaption>
    </figure>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  );
}
