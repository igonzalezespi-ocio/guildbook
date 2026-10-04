import clsx from "clsx";
import type { ReactNode } from "react";
import { Panel, Tag } from "@/components/ui";
import { formatDuration, formatNumber, formatPct, formatSeconds, METRIC_LABELS, resourceLabel, scoreTone } from "@/lib/vigil/format";
import type { FightReport } from "@/lib/vigil/report";
import { FightTimeline } from "./timeline";

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded border border-line bg-ink/40 px-3 py-2">
      <p className="text-[0.65rem] tracking-widest text-muted uppercase">{label}</p>
      <p className="text-lg font-semibold text-bone">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Bar({ value, target = 1, tone = "gold" }: { value: number; target?: number; tone?: "gold" | "crimson" }) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded bg-ink">
      <div
        className={clsx("h-full rounded", tone === "gold" ? "bg-gold" : "bg-crimson-bright")}
        style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }}
      />
      {target < 1 && <div className="absolute top-0 h-full w-0.5 bg-bone/70" style={{ left: `${target * 100}%` }} title="Objetivo" />}
    </div>
  );
}

export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Puntuación ${score} de 100`} className="shrink-0">
      <circle cx={50} cy={50} r={r} fill="none" stroke="var(--color-line)" strokeWidth={8} />
      <circle
        cx={50}
        cy={50}
        r={r}
        fill="none"
        stroke={score >= 60 ? "var(--color-gold)" : "var(--color-crimson-bright)"}
        strokeWidth={8}
        strokeDasharray={`${(score / 100) * c} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x={50} y={58} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--color-bone)">
        {score}
      </text>
    </svg>
  );
}

export function FightReportView({ report }: { report: FightReport }) {
  const { totals, activity, estimate, model } = report;
  const seconds = report.fight.durationMs / 1000;
  const metric = model?.metric ?? "damage";
  const perSecond = metric === "threat" ? totals.tps : metric === "healing" ? totals.hps : totals.dps;

  return (
    <div className="space-y-4" data-testid="vigil-report">
      <Panel>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <ScoreRing score={report.score.overall} />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={clsx("text-xl font-semibold", scoreTone(report.score.overall))}>
                {report.score.overall >= 85 ? "Muy bien llevado" : report.score.overall >= 60 ? "Constante" : "Margen de mejora"}
              </h2>
              <Tag>{model?.label ?? "Análisis general"}</Tag>
              <Tag>{report.fight.kind === "boss" ? "Jefe" : "Bichos"}</Tag>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {report.score.parts.map((p) => (
                <li key={p.label} className="text-sm">
                  <div className="mb-1 flex justify-between gap-2">
                    <span className="text-muted">{p.label}</span>
                    <span className="text-bone">{formatPct(p.value)}</span>
                  </div>
                  <Bar value={p.value} tone={p.value >= 0.6 ? "gold" : "crimson"} />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Duración" value={formatDuration(report.fight.durationMs)} />
          <Stat label={`${METRIC_LABELS[metric]} por segundo`} value={formatNumber(perSecond)} />
          <Stat
            label="Uso del GCD"
            value={formatPct(activity.gcdUsage)}
            hint={`${activity.gcdCasts} lanzamientos, GCD de ${formatSeconds(activity.gcdMs)}`}
          />
          <Stat
            label={activity.readyIdleMs !== null ? "Inactivo con algo listo" : "Huecos inactivos"}
            value={
              activity.readyIdleMs !== null
                ? formatSeconds(activity.readyIdleMs)
                : formatSeconds(activity.idleGaps.reduce((a, [s, e]) => a + (e - s), 0))
            }
          />
        </div>
      </Panel>

      <Panel title="Cronología">
        <FightTimeline report={report} />
      </Panel>

      {estimate && (
        <Panel title="Estimación frente a lo real">
          <p className="mb-3 text-sm text-muted">
            Una repetición de este mismo combate con una ejecución perfecta. Es una estimación: lee los supuestos de abajo
            antes de tomarte la cifra al pie de la letra.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label={`Tu ${METRIC_LABELS[estimate.metric].toLowerCase()}`} value={formatNumber(estimate.actual)} hint={`${formatNumber(estimate.actual / seconds)} por segundo`} />
            <Stat
              label="Estimado con ejecución perfecta"
              value={formatNumber(estimate.estimated)}
              hint={`${formatNumber(estimate.estimated / seconds)} por segundo`}
            />
            <Stat label="Eficiencia" value={formatPct(estimate.efficiency)} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gold">De dónde sale la diferencia</h3>
              {estimate.gains.length === 0 ? (
                <p className="text-sm text-muted">No queda nada medible por mejorar.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {estimate.gains.map((g) => (
                    <li key={g.label} className="flex justify-between gap-2">
                      <span>{g.label}</span>
                      <span className={g.amount >= 0 ? "text-gold" : "text-muted"}>
                        {g.amount >= 0 ? "+" : ""}
                        {formatNumber(g.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {estimate.simCasts.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-1 font-normal">Habilidad</th>
                      <th className="py-1 text-right font-normal">Tú</th>
                      <th className="py-1 text-right font-normal">Repetición</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimate.simCasts.map((c) => (
                      <tr key={c.label} className="border-t border-line">
                        <td className="py-1">{c.label}</td>
                        <td className="py-1 text-right">{c.actual}</td>
                        <td className="py-1 text-right text-gold">{c.simulated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gold">Supuestos</h3>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                {estimate.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {report.adherence && (
          <Panel title="Seguimiento de prioridades">
            <p className="mb-3 text-sm text-muted">
              {report.adherence.matched} de {report.adherence.decisions} tiempos de reutilización global fueron a la habilidad
              más prioritaria que estaba lista.
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">Paso</th>
                  <th className="py-1 text-right font-normal">Tocaba</th>
                  <th className="py-1 text-right font-normal">Hecho</th>
                </tr>
              </thead>
              <tbody>
                {report.adherence.steps.map((s) => (
                  <tr key={s.label} className="border-t border-line">
                    <td className="py-1">{s.label}</td>
                    <td className="py-1 text-right">{s.expected}</td>
                    <td className={clsx("py-1 text-right", s.done < s.expected ? "text-crimson-bright" : "text-gold")}>{s.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.adherence.misses.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-gold">Lanzamientos fuera de prioridad ({report.adherence.misses.length})</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {report.adherence.misses.map((m, i) => (
                    <li key={i}>
                      {formatSeconds(m.t)}: {m.actual} cuando la prioridad era {m.expected.toLowerCase()}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>
        )}

        {(report.uptimes.length > 0 || report.procs.length > 0 || report.cooldowns.length > 0) && (
          <Panel title="Tiempos activos y reutilizaciones">
            <ul className="space-y-3 text-sm">
              {report.uptimes.map((u) => (
                <li key={u.key}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span>
                      {u.label}
                      {u.scored && <span className="ml-1 text-xs text-muted">(objetivo {formatPct(u.targetPct)})</span>}
                    </span>
                    <span>{formatPct(u.pct)}</span>
                  </div>
                  <Bar value={u.pct} target={u.scored ? u.targetPct : 1} tone={!u.scored || u.pct >= u.targetPct * 0.8 ? "gold" : "crimson"} />
                </li>
              ))}
              {report.procs.map((p) => (
                <li key={p.key}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span>{p.label}</span>
                    <span>
                      {p.used} de {p.usable} posibles
                    </span>
                  </div>
                  <Bar value={p.pct} tone={p.pct >= 0.7 ? "gold" : "crimson"} />
                </li>
              ))}
              {report.cooldowns.map((c) => (
                <li key={c.key} className="flex justify-between gap-2 border-t border-line pt-2">
                  <span>{c.label}</span>
                  <span className="text-muted">
                    {c.casts} de {c.possible} usos posibles
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Comprobaciones">
          <ul className="space-y-2 text-sm">
            {report.swings && (
              <li className="flex justify-between gap-2">
                <span>Ataques automáticos perdidos por huecos</span>
                <span className={report.swings.lostSwings > 0 ? "text-crimson-bright" : "text-gold"}>
                  {report.swings.lostSwings} (un golpe cada {formatSeconds(report.swings.medianIntervalMs)})
                </span>
              </li>
            )}
            {report.extras.seal && (
              <>
                <li className="flex justify-between gap-2">
                  <span>Tiempo sin sello</span>
                  <span className={report.extras.seal.timeWithoutSealMs > 0 ? "text-crimson-bright" : "text-gold"}>
                    {formatSeconds(report.extras.seal.timeWithoutSealMs)}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span>Judgements</span>
                  <span>
                    {report.extras.seal.judgements}
                    {report.extras.seal.medianJudgementIntervalMs !== null &&
                      `, cada ${formatSeconds(report.extras.seal.medianJudgementIntervalMs)}`}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span>Judgement consume el sello</span>
                  <span className="text-muted">{report.extras.seal.consumesSeal ? "Sí (según el registro)" : "No (según el registro)"}</span>
                </li>
              </>
            )}
            {report.extras.rageDump && (
              <li className="flex justify-between gap-2">
                <span>Heroic Strike en golpes con {report.extras.rageDump.threshold}+ de ira</span>
                <span>
                  {report.extras.rageDump.used} de {report.extras.rageDump.opportunities}
                </span>
              </li>
            )}
            {report.resource && (
              <>
                <li className="flex justify-between gap-2">
                  <span>Tiempo con {resourceLabel(report.resource.name).toLowerCase()} al máximo</span>
                  <span>{formatSeconds(report.resource.timeAtCapMs)}</span>
                </li>
                {report.resource.name === "Rage" && (
                  <li className="flex justify-between gap-2">
                    <span>Ira desperdiciada al máximo (estimación)</span>
                    <span>{formatNumber(report.resource.wastedEstimate)}</span>
                  </li>
                )}
              </>
            )}
            <li className="flex justify-between gap-2">
              <span>Daño recibido</span>
              <span>{formatNumber(totals.damageTaken)}</span>
            </li>
          </ul>
        </Panel>

        <Panel title="Objetivos">
          <ul className="space-y-1 text-sm">
            {report.fight.targets.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex justify-between gap-2">
                <span>
                  {t.name}
                  {t.npcId && <span className="ml-1 text-xs text-muted">NPC {t.npcId}</span>}
                  {t.died && <span className="ml-1 text-xs text-gold-dim">abatido</span>}
                </span>
                <span className="text-muted">{formatNumber(t.damageTaken)} infligido</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Habilidades">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-normal">Habilidad</th>
                <th className="py-1 text-right font-normal">Lanzamientos</th>
                <th className="py-1 text-right font-normal">Impactos</th>
                <th className="py-1 text-right font-normal">Crítico</th>
                <th className="py-1 text-right font-normal">Fallos</th>
                <th className="py-1 text-right font-normal">Daño</th>
                {totals.healing > 0 && <th className="py-1 text-right font-normal">Sanación</th>}
                <th className="py-1 text-right font-normal">Amenaza</th>
              </tr>
            </thead>
            <tbody>
              {report.spells.map((s) => (
                <tr key={s.name} className="border-t border-line">
                  <td className="py-1">{s.name}</td>
                  <td className="py-1 text-right">{s.casts || ""}</td>
                  <td className="py-1 text-right">{s.hits || ""}</td>
                  <td className="py-1 text-right">{s.hits ? formatPct(s.crits / s.hits) : ""}</td>
                  <td className="py-1 text-right">{s.misses || ""}</td>
                  <td className="py-1 text-right">{s.damage ? formatNumber(s.damage) : ""}</td>
                  {totals.healing > 0 && <td className="py-1 text-right">{s.healing ? formatNumber(s.healing) : ""}</td>}
                  <td className="py-1 text-right text-gold">{s.threat ? formatNumber(s.threat) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">La amenaza es una estimación a partir del daño, las bonificaciones de las habilidades y la actitud; el juego no registra la amenaza.</p>
      </Panel>

      {(report.notes.length > 0 || report.snapshot) && (
        <Panel title="Sobre este registro">
          {report.snapshot && (
            <p className="mb-2 text-sm">
              Instantánea del equipo desde Vigil: {report.snapshot.name}
              {report.snapshot.level ? `, nivel ${report.snapshot.level}` : ""}, {report.snapshot.gear.length} objetos,{" "}
              {report.snapshot.talents.length} entradas de talentos.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Panel>
      )}
      <p className="text-center text-xs text-muted">
        Formato de registro {report.log.version ?? "desconocido"}
        {report.log.build && `, compilación ${report.log.build}`}
        {report.log.advanced ? ", registro avanzado activado" : ", registro avanzado desactivado"}.
      </p>
    </div>
  );
}
