import { FactionBadge } from "@/components/ui";
import { DAYS_OF_WEEK } from "@/lib/game";
import { formatClock, timezoneAbbrev } from "@/lib/format";
import type { raidScheduleSlots } from "@/db/schema";

export function ScheduleList({
  slots,
  timezone,
  showFaction,
}: {
  slots: (typeof raidScheduleSlots.$inferSelect)[];
  timezone: string;
  showFaction: boolean;
}) {
  if (slots.length === 0) return <p className="text-sm text-muted italic">Horario por anunciar.</p>;
  const tz = timezoneAbbrev(timezone);
  return (
    <ul className="divide-y divide-line">
      {slots.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div>
            <p className="font-display font-semibold text-bone">{DAYS_OF_WEEK[s.dayOfWeek]}</p>
            <p className="text-sm text-muted">{s.label}</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {showFaction && s.faction && <FactionBadge faction={s.faction} />}
            <span className="text-gold">
              {formatClock(s.startTime)} – {formatClock(s.endTime)} {tz}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
