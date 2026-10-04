import type { Metadata } from "next";
import { Markdown } from "@/components/markdown";
import { EmptyState } from "@/components/ui";
import { db } from "@/db";
import { LORE_MD, LORE_SLUG, LORE_TITLE } from "@/lib/lore";
import { getGuild } from "@/server/context";
import { guildSocialMetadata } from "@/server/guild-metadata";
import { getContentPage } from "@/server/services/content";

const DISCLAIMERS = [
  "The Light of Azeroth is not God. It is a gleam in a made world, and we do not pray to it.",
  "Christ is not a figure of Azeroth. No character, naaru or hero of the game stands in for Him.",
  "There are no sacraments in the game. We do not baptise characters, say Mass or hear confessions in Azeroth.",
];

const FURTHER_READING = [
  {
    title: "On Fairy-Stories",
    author: "J.R.R. Tolkien",
    note: "Sub-creation, and the Gospel as the true eucatastrophe.",
    href: "https://en.wikipedia.org/wiki/On_Fairy-Stories",
  },
  {
    title: "Mythopoeia",
    author: "J.R.R. Tolkien",
    note: "Man as sub-creator, the refracted light.",
    href: "https://en.wikipedia.org/wiki/Mythopoeia_(poem)",
  },
  {
    title: "Leaf by Niggle",
    author: "J.R.R. Tolkien",
    note: "How our making might be taken up into Creation.",
    href: "https://en.wikipedia.org/wiki/Leaf_by_Niggle",
  },
  {
    title: "Towards Full Presence",
    author: "Dicastery for Communication, 2023",
    note: "Witness, not proselytism, in digital spaces.",
    href: "https://press.vatican.va/content/salastampa/en/bollettino/pubblico/2023/05/29/230529g.html",
  },
];

async function loadLore(slug: string) {
  const guild = await getGuild(slug);
  const page = await getContentPage(db, guild.id, LORE_SLUG);
  const order = guild.preset === "order";
  return {
    guild,
    title: page?.title || (order ? LORE_TITLE : "Nuestra historia"),
    bodyMd: page?.bodyMd.trim() ? page.bodyMd : order ? LORE_MD : null,
  };
}

export async function generateMetadata({ params }: PageProps<"/[guild]/lore">): Promise<Metadata> {
  const { guild: slug } = await params;
  const { guild, title } = await loadLore(slug);
  const pageTitle = guild.preset === "order" ? "Historia" : title;
  const description =
    guild.preset === "order"
      ? `${title}: cómo entiende ${guild.name} Azeroth, la Luz y su misión como peregrinos.`
      : `${title}: la historia de ${guild.name}.`;
  return { title: pageTitle, description, ...(await guildSocialMetadata(slug, "lore", { title: pageTitle, description })) };
}

export default async function LorePage({ params }: PageProps<"/[guild]/lore">) {
  const { guild: slug } = await params;
  const { guild, title, bodyMd } = await loadLore(slug);
  const order = guild.preset === "order";
  const motto = guild.motto ?? (order ? "Quis ut Deus" : null);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 text-center sm:mb-10">
        {motto && <p className="font-display text-xs tracking-[0.35em] text-crimson-bright uppercase">{motto}</p>}
        <h1 className="mt-3 font-title text-3xl break-words text-gold sm:text-5xl">{title}</h1>
        <hr className="rule-gold mx-auto mt-5 w-48" />
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed break-words text-muted italic sm:text-base">
          {order ? `Cómo ve ${guild.name} el mundo en el que juega, y la Luz más allá de él.` : `La historia de ${guild.name}.`}
        </p>
      </header>

      {bodyMd ? (
        <article className="parchment lore px-5 py-8 sm:px-12 sm:py-12">
          <Markdown>{bodyMd}</Markdown>
        </article>
      ) : (
        <EmptyState>{guild.name} aún no ha escrito su historia.</EmptyState>
      )}

      {order && (
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <aside className="panel p-5 sm:p-6" aria-labelledby="not-claim-heading">
          <h2 id="not-claim-heading" className="font-display text-sm font-semibold tracking-[0.2em] text-gold uppercase">
            Lo que no afirmamos
          </h2>
          <hr className="rule-gold my-3 w-16" />
          <ul className="space-y-3 text-sm leading-relaxed text-bone/90">
            {DISCLAIMERS.map((d) => (
              <li key={d} className="flex gap-3">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rotate-45 bg-crimson-bright" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel p-5 sm:p-6" aria-labelledby="reading-heading">
          <h2 id="reading-heading" className="font-display text-sm font-semibold tracking-[0.2em] text-gold uppercase">
            Para seguir leyendo
          </h2>
          <hr className="rule-gold my-3 w-16" />
          <ul className="space-y-3">
            {FURTHER_READING.map((r) => (
              <li key={r.title}>
                <a href={r.href} target="_blank" rel="noopener noreferrer" className="link font-display text-sm">
                  {r.title}
                </a>
                <span className="text-xs text-gold-dim"> de {r.author}</span>
                <p className="text-sm text-muted">{r.note}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      )}
    </div>
  );
}
