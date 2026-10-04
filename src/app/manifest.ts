import type { MetadataRoute } from "next";
import { brandManifestIcons, GUILDBOOK_DESCRIPTION } from "@/lib/brand";
import { getSiteIdentity } from "@/server/site";

/** Per host: a guild's name and icons on its own host, Guildbook's on the apex. Icons come from `pnpm brand:assets`. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { guild, brand } = await getSiteIdentity();
  return {
    name: guild?.name ?? "Guildbook",
    short_name: guild ? guild.name.slice(0, 24) : "Guildbook",
    description: guild?.description || GUILDBOOK_DESCRIPTION,
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0908",
    theme_color: "#0b0908",
    icons: brandManifestIcons(brand),
  };
}
