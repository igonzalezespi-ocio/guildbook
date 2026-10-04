import Link from "next/link";
import { GuildbookMark } from "@/components/guildbook-mark";
import { displayDomain } from "@/lib/product-domain";
import { Panel } from "@/components/ui";
import { db } from "@/db";
import { getSessionUser } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { listDirectoryGuilds, listUserGuilds } from "@/server/services/platform";
import { FEATURE_ICONS, type FeatureIcon } from "./feature-icons";
import { GuildCard } from "./guild-card";
import { exampleSites, loadShowcase, SitePreview } from "./site-preview";

/** The guild shown in the home page preview when it is listed in the directory. */
const SHOWCASE_SLUG = "osm";

const features = (domain: string): { icon: FeatureIcon; title: string; body: string; link?: { href: string; label: string } }[] => [
  { icon: "address", title: "Tu propia dirección", body: `Cada hermandad tiene un subdominio como tuhermandad.${domain} y más adelante puede usar su propio dominio.` },
  { icon: "applications", title: "Solicitudes", body: "Los aspirantes inician sesión con Discord y pueden verificar su personaje con Battle.net." },
  { icon: "roster", title: "Plantilla y rangos", body: "Tu escala de rangos, principales y alters, profesiones y quién puede hacer qué en la administración." },
  { icon: "raids", title: "Noches de banda", body: "Horario, necesidades de reclutamiento y progreso, en la zona horaria de tu hermandad." },
  { icon: "charter", title: "Reglamento e historia", body: "Páginas en Markdown para tus normas, tu política de botín y tu historia, con historial completo de cambios." },
  {
    icon: "vigil",
    title: "Vigil",
    body: "Los miembros suben sus registros de combate para un análisis privado de cada pull: rotación, tiempo activo de auras y reutilizaciones.",
    link: { href: "/vigil", label: "Descarga la app de escritorio" },
  },
];

const steps = [
  { title: "Inicia sesión con Discord", body: "Una sola cuenta de Guildbook sirve para todas las hermandades. No hay contraseñas que recordar." },
  { title: "Ponle nombre a tu hermandad", body: "Elige subdominio, región, facción y zona horaria. Tu web empieza como un borrador privado y la publicas cuando esté lista." },
  { title: "Abre las puertas", body: "Comparte el enlace. Los reclutas envían su solicitud, los oficiales la revisan y los miembros entran con la misma cuenta." },
];

export default async function PlatformHome() {
  const [user, current] = await Promise.all([getSessionUser(), getRequestHost()]);
  const [mine, directory] = await Promise.all([user ? listUserGuilds(db, user.id) : [], listDirectoryGuilds(db)]);
  const hrefFor = (g: { slug: string; customDomain: string | null }, path = "") => `${guildOrigin(g.slug, current, g.customDomain)}${path}`;
  const domain = displayDomain(current.config.rootDomain);
  const showcase = directory.find((g) => g.slug === SHOWCASE_SLUG) ?? directory[0];
  const now = new Date();
  const previewSites = [
    ...(showcase ? [await loadShowcase(db, showcase, showcase.customDomain ?? `${showcase.slug}.${domain}`, hrefFor(showcase), now)] : []),
    ...exampleSites(domain),
  ];

  return (
    <div className="space-y-16 sm:space-y-20">
      <section className="flex flex-col items-center pt-4 text-center">
        <GuildbookMark className="h-24 w-24 drop-shadow-[0_0_28px_rgba(201,164,76,0.35)] sm:h-28 sm:w-28" />
        <p className="mt-6 font-display text-xs tracking-[0.3em] text-gold/80 uppercase">Webs de hermandad para World of Warcraft: Forever</p>
        <h1 className="mt-3 max-w-3xl font-title text-3xl text-gold sm:text-5xl">Un hogar para tu hermandad</h1>
        <hr className="rule-gold mt-5 w-56" />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-bone/90">
          Guildbook le da a tu hermandad una web propia: solicitudes, plantilla, horario de bandas, progreso y análisis de
          registros de combate, gestionados por tus oficiales.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/create" className="btn btn-gold px-7">
            Crea tu hermandad
          </Link>
          <Link href="/guilds" className="btn btn-ghost">
            Ver hermandades
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">Inicia sesión con Discord y tu web estará lista en un par de minutos.</p>
      </section>

      {user && (
        <Panel title="Tus hermandades">
          {mine.length === 0 ? (
            <p className="text-sm text-muted">
              Aún no estás en ninguna hermandad de Guildbook. <Link href="/guilds" className="link">Busca una</Link> o{" "}
              <Link href="/create" className="link">crea la tuya</Link>.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="your-guilds">
              {mine.map((g) => (
                <GuildCard key={g.slug} guild={g} href={hrefFor(g)}>
                  <span className="text-gold">{g.status === "applicant" ? "Solicitud pendiente" : g.rankName}</span>
                  {g.status === "active" && (g.rankTier === "admin" || g.rankTier === "officer") && (
                    <a href={hrefFor(g, "/admin")} className="link">
                      Administrar
                    </a>
                  )}
                </GuildCard>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <section aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="sr-only">
          Así es una web de hermandad
        </h2>
        <SitePreview sites={previewSites} now={now} />
      </section>

      <section>
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold text-gold">Todo lo que necesita una hermandad</h2>
          <p className="mt-2 text-sm text-muted">Pensado para cómo funcionan de verdad las hermandades, de la primera solicitud al último jefe.</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features(domain).map((f) => (
            <li key={f.title} className="panel p-5 transition-colors hover:border-gold-dim">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold-dim/60 bg-gold/10 text-gold shadow-[inset_0_1px_0_rgb(230_200_119/0.15)]">
                  {FEATURE_ICONS[f.icon]}
                </span>
                <h3 className="font-display text-base font-semibold text-gold">{f.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{f.body}</p>
              {f.link && (
                <Link href={f.link.href} className="link mt-2 inline-block text-sm">
                  {f.link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-8 text-center text-2xl font-semibold text-gold">En marcha esta misma noche</h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-col items-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold-dim font-display text-sm font-semibold text-gold">
                {["I", "II", "III"][i]}
              </span>
              <h3 className="mt-3 font-display text-base font-semibold text-bone">{s.title}</h3>
              <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {directory.length > 0 && (
        <section>
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold text-gold">Hermandades en Guildbook</h2>
            <Link href="/guilds" className="link text-sm">
              Ver el directorio
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {directory.slice(0, 6).map((g) => (
              <GuildCard key={g.slug} guild={g} href={hrefFor(g)}>
                <span>{g.members === 1 ? "1 miembro" : `${g.members} miembros`}</span>
              </GuildCard>
            ))}
          </ul>
        </section>
      )}

      <section className="panel flex flex-col items-center px-6 py-10 text-center">
        <h2 className="font-title text-2xl text-gold sm:text-3xl">Alza tu estandarte</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Dale a tu hermandad una dirección, una puerta de entrada para los reclutas y un único sitio para todo lo que llevan tus
          oficiales.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/create" className="btn btn-gold px-7">
            Crea tu hermandad
          </Link>
          <Link href="/guilds" className="btn btn-ghost">
            Ver hermandades
          </Link>
        </div>
      </section>
    </div>
  );
}
