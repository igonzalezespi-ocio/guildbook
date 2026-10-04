import { Crest } from "@/components/crest";
import { TabardCrest } from "@/components/tabard-crest";
import { guildLook, isOrderLook, type LookColumns } from "@/lib/tabard/look";

/** The Order keeps its hand-drawn crest; every other guild shows its in-game tabard. */
export function GuildEmblem({ guild, className }: { guild: { name: string } & LookColumns; className?: string }) {
  return isOrderLook(guild) ? <Crest className={className} /> : <TabardCrest tabard={guildLook(guild).tabard} label={`Tabardo de ${guild.name}`} className={className} />;
}
