import clsx from "clsx";

const TITLE = "Hermandad verificada: su maestro de la hermandad demostró su rango en el juego con Battle.net";

/** A small wax-seal rosette with a check, for guilds whose in-game Guild Master is verified. */
export function VerifiedSeal({
  size = 14,
  label = false,
  className,
}: {
  size?: number;
  /** Show the word "Verified" beside the seal. */
  label?: boolean;
  className?: string;
}) {
  const seal = (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden={label || undefined} role={label ? undefined : "img"} className="shrink-0">
      {!label && <title>{TITLE}</title>}
      <path
        d="M8 .8l1.6 1.3 2-.4.8 1.9 1.9.8-.4 2L15.2 8l-1.3 1.6.4 2-1.9.8-.8 1.9-2-.4L8 15.2l-1.6-1.3-2 .4-.8-1.9-1.9-.8.4-2L.8 8l1.3-1.6-.4-2 1.9-.8.8-1.9 2 .4Z"
        className="fill-gold"
      />
      <path d="m5.2 8.2 1.9 1.9 3.8-4" fill="none" className="stroke-ink" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (!label) return <span className={clsx("inline-flex", className)} data-testid="verified-seal">{seal}</span>;
  return (
    <span
      className={clsx("inline-flex items-center gap-1 text-[0.65rem] font-semibold tracking-wider text-gold uppercase", className)}
      title={TITLE}
      data-testid="verified-seal"
    >
      {seal}
      Verificada
    </span>
  );
}
