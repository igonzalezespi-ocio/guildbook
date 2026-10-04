import Link from "next/link";
import type { ReactNode } from "react";
import { BlizzardItemAttribution, ItemLink } from "@/components/item-link";
import { CharacterLink, EmptyState, Tag } from "@/components/ui";
import { formatCalendarDate, shownName } from "@/lib/format";
import { LOOT_RESPONSE_LABELS, NO_RECIPIENT_RESPONSES } from "@/lib/loot/constants";
import { guildHref } from "@/lib/paths";
import type { LootRow } from "@/server/services/loot";

function Recipient({ slug, row }: { slug: string; row: LootRow }) {
  if (row.character) return <CharacterLink guildSlug={slug} character={row.character} />;
  if (row.recipientName) return <span className="text-bone">{shownName(row.recipientName)}</span>;
  return <span className="text-muted">{NO_RECIPIENT_RESPONSES.has(row.response) ? LOOT_RESPONSE_LABELS[row.response] : "Desconocido"}</span>;
}

/** The ledger as a table. Reversed awards stay visible, struck through, with the reason. */
export function LootTable({
  slug,
  rows,
  showDate = true,
  showRecipient = true,
  actions,
  empty = "Aún no hay botín registrado.",
}: {
  slug: string;
  rows: LootRow[];
  showDate?: boolean;
  showRecipient?: boolean;
  actions?: (row: LootRow) => ReactNode;
  empty?: string;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const attribution = rows.some((r) => r.itemFromBlizzard || r.icon);
  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs tracking-wider text-muted uppercase">
            <tr className="border-b border-line">
              {showDate && <th className="py-2 pr-4 font-normal">Banda</th>}
              <th className="py-2 pr-4 font-normal">Objeto</th>
              {showRecipient && <th className="py-2 pr-4 font-normal">Destinatario</th>}
              <th className="py-2 pr-4 font-normal">Motivo</th>
              <th className="py-2 pr-4 font-normal">Jefe</th>
              {actions && <th className="py-2 font-normal">
                <span className="sr-only">Acciones</span>
              </th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const reversed = Boolean(row.reversal);
              const label = LOOT_RESPONSE_LABELS[row.response];
              const tool = row.responseText && row.responseText.toLowerCase() !== label.toLowerCase() ? row.responseText : null;
              return (
                <tr key={row.id} className="align-top">
                  {showDate && (
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <Link href={guildHref(slug, `/members/loot/raids/${row.raidDate}`)} className="text-muted hover:text-gold">
                        {formatCalendarDate(row.raidDate)}
                      </Link>
                    </td>
                  )}
                  <td className="py-2 pr-4">
                    <div className={reversed ? "line-through opacity-60" : undefined}>
                      <ItemLink itemId={row.itemId} name={row.itemName} quality={row.quality} icon={row.icon} gameVersion={row.gameVersion} />
                    </div>
                    {row.reversal && (
                      <p className="mt-1 text-xs text-muted">
                        <Tag className="mr-1.5">Anulada</Tag>
                        {row.reversal.reason}
                      </p>
                    )}
                    {row.note && !reversed && <p className="mt-1 text-xs text-muted italic">{shownName(row.note)}</p>}
                  </td>
                  {showRecipient && (
                    <td className={`py-2 pr-4 ${reversed ? "line-through opacity-60" : ""}`}>
                      <Recipient slug={slug} row={row} />
                    </td>
                  )}
                  <td className="py-2 pr-4 text-muted">
                    {label}
                    {tool && <span className="block text-xs">{tool}</span>}
                    {row.votes !== null && row.votes > 0 && (
                      <span className="block text-xs">
                        {row.votes} vote{row.votes === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-muted">
                    {row.bossName ?? "Desconocido"}
                    {row.instanceName && <span className="block text-xs">{row.instanceName}</span>}
                  </td>
                  {actions && <td className="py-2">{actions(row)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {attribution && <BlizzardItemAttribution />}
    </div>
  );
}
