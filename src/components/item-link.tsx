import Image from "next/image";
import type { GuildVersion } from "@/lib/game-versions";
import { ITEM_QUALITY_INFO, type ItemQuality } from "@/lib/loot/constants";
import { itemIconUrl, wowheadItemUrl } from "@/lib/loot/items";

/**
 * An item name in its quality colour, linking to Wowhead. The icon is hotlinked from Blizzard's render CDN (never
 * stored), and only when the item cache knows it.
 */
export function ItemLink({
  itemId,
  name,
  quality,
  icon,
  gameVersion,
  size = 20,
  className = "",
}: {
  itemId: number;
  name: string;
  quality: ItemQuality | null;
  icon?: string | null;
  /** The guild's version: which Wowhead database the link opens. */
  gameVersion?: GuildVersion;
  size?: number;
  className?: string;
}) {
  // Poor and common read as muted and plain text on the dark theme; the rest use the in-game colours.
  const tone = quality === 0 ? "text-muted" : quality === null || quality === 1 ? "text-bone" : "";
  const style = quality !== null && quality > 1 ? { color: ITEM_QUALITY_INFO[quality].color } : undefined;
  return (
    <a
      href={wowheadItemUrl(itemId, gameVersion)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 font-medium hover:underline ${tone} ${className}`}
      style={style}
      title={quality !== null ? `Objeto ${ITEM_QUALITY_INFO[quality].label.toLowerCase()}, abre Wowhead` : "Abre Wowhead"}
    >
      {icon ? (
        <Image
          src={itemIconUrl(icon)}
          width={size}
          height={size}
          alt=""
          unoptimized
          className="shrink-0 rounded-sm border border-line"
        />
      ) : null}
      <span>{name}</span>
    </a>
  );
}

/** Required wherever item details from Blizzard's Game Data API are shown. */
export function BlizzardItemAttribution() {
  return (
    <p className="mt-4 text-xs text-muted">
      Algunos nombres e iconos de objetos los proporciona Blizzard Entertainment. World of Warcraft y Blizzard
      Entertainment son marcas comerciales o marcas registradas de Blizzard Entertainment, Inc.
    </p>
  );
}
