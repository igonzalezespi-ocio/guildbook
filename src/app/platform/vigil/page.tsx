import clsx from "clsx";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { GitHubIcon } from "@/components/github-icon";
import { Markdown } from "@/components/markdown";
import { brandPreviewImage } from "@/lib/brand";
import { formatDate } from "@/lib/format";
import {
  COMPANION_RELEASES_URL,
  COMPANION_REPO_URL,
  type CompanionPlatform,
  type CompanionRelease,
  detectPlatform,
  formatBytes,
  PLATFORM_LABELS,
  primaryAsset,
} from "@/lib/vigil/companion-release";
import { latestCompanionRelease } from "@/server/companion-release";
import { FEATURE_ICONS, type FeatureIcon } from "../feature-icons";
import { AppScreenshot } from "./app-screenshot";
import detailShot from "./shots/detail.webp";
import intelShot from "./shots/intel.webp";
import liveShot from "./shots/live.webp";

const TITLE = "Vigil, la app complementaria para el registro de combate";
const DESCRIPTION =
  "Vigil vigila tu registro de combate de World of Warcraft: Forever, te avisa de los fallos mientras juegas y sube cada combate al Guildbook de tu hermandad. Gratis para Windows, macOS y Linux.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/vigil" },
  openGraph: { type: "website", siteName: "Guildbook", title: TITLE, description: DESCRIPTION, url: "/vigil", images: [brandPreviewImage("vigil")] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [brandPreviewImage("vigil")] },
};

const PLATFORMS: CompanionPlatform[] = ["mac", "windows", "linux"];

const PLATFORM_DETAIL: Record<CompanionPlatform, string> = {
  mac: "universal para Apple silicon e Intel",
  windows: "64 bits, Windows 10 y 11",
  linux: "AppImage, 64 bits",
};

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function External({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={clsx("link", FOCUS, className)} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** The big button for the visitor's system, the other systems beside it, or all three when the system is unknown. */
function Downloads({
  release,
  platform,
  hero = false,
}: {
  release: CompanionRelease;
  platform: CompanionPlatform | null;
  /** The hero copy: left-aligned on wide screens and carrying the test IDs. */
  hero?: boolean;
}) {
  const main = platform ? primaryAsset(release, platform) : null;
  const others = PLATFORMS.filter((p) => p !== platform && primaryAsset(release, p));
  return (
    <div className={clsx("flex flex-col items-center gap-4", hero && "lg:items-start")}>
      {main && platform ? (
        <div className={clsx("flex flex-col items-center gap-2", hero && "lg:items-start")}>
          <a
            href={main.url}
            className={clsx("btn btn-gold min-h-13 px-8 text-sm shadow-[0_8px_28px_rgb(201_164_76/0.25)]", FOCUS)}
            data-testid={hero ? "vigil-download-primary" : undefined}
          >
            <DownloadIcon />
            Descargar para {PLATFORM_LABELS[platform]}
          </a>
          <p className="text-xs text-muted">
            Versión {release.version}, {formatBytes(main.size)}, {PLATFORM_DETAIL[platform]}
          </p>
        </div>
      ) : (
        <p className="max-w-md text-sm text-muted">
          {platform
            ? `Aún no hay versión para ${PLATFORM_LABELS[platform]} de la ${release.version}.`
            : `Vigil es una app de escritorio. Descarga la versión ${release.version} en el ordenador con el que juegas.`}
        </p>
      )}
      {others.length > 0 && (
        <div
          className={clsx(
            "flex items-center justify-center gap-2",
            main ? "flex-wrap" : "w-full max-w-xs flex-col sm:w-auto sm:max-w-none sm:flex-row",
            hero && "lg:justify-start",
          )}
        >
          {main && <span className="text-xs text-muted">También para</span>}
          {others.map((p) => {
            const asset = primaryAsset(release, p)!;
            return (
              <a
                key={p}
                href={asset.url}
                className={clsx("btn btn-ghost btn-sm", !main && "w-full sm:w-auto", FOCUS)}
                aria-label={`Descargar para ${PLATFORM_LABELS[p]}, ${formatBytes(asset.size)}`}
              >
                <DownloadIcon />
                {PLATFORM_LABELS[p]}
                <span className="font-sans text-[0.65rem] font-normal tracking-normal text-muted normal-case">{formatBytes(asset.size)}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NoRelease({ ok, hero = false }: { ok: boolean; hero?: boolean }) {
  return (
    <div className={clsx("flex flex-col items-center gap-3", hero && "lg:items-start")} data-testid={hero ? "vigil-no-release" : undefined}>
      <a href={COMPANION_RELEASES_URL} className={clsx("btn btn-gold min-h-13 px-8 text-sm", FOCUS)} target="_blank" rel="noopener noreferrer">
        <DownloadIcon />
        Consigue Vigil en GitHub
      </a>
      <p className="max-w-md text-xs text-muted">
        {ok ? "La primera versión está en camino." : "Ahora mismo no se ha podido cargar la última versión."} Todas las versiones se
        publican en la página de versiones.
      </p>
    </div>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Instala Vigil",
    body: "Descárgalo para Windows, macOS o Linux y ábrelo. Encuentra solo la carpeta Logs de World of Warcraft.",
  },
  {
    title: "Activa el registro de combate",
    body: (
      <>
        En el juego, activa el registro de combate avanzado en Sistema &gt; Red y escribe <code className="text-gold">/combatlog</code> cada
        vez que entres.
      </>
    ),
  },
  {
    title: "Emparéjalo con tu hermandad",
    body: "En la web de tu hermandad, abre Vigil y elige Conectar la app de Vigil para obtener un código de emparejamiento. Escríbelo en la app y listo.",
  },
];

const FEATURES: { icon: FeatureIcon; title: string; body: string }[] = [
  {
    icon: "callouts",
    title: "Avisos mientras juegas",
    body: "Procs desaprovechados, tiempo parado, beneficios caídos e ira al máximo aparecen en el momento en que pasan, junto a una puntuación en directo, el uso del GCD y el tiempo activo de auras con sus iconos de hechizo.",
  },
  {
    icon: "intel",
    title: "Información de jefes",
    body: "Molten Core y Onyxia's Lair, habilidad a habilidad: qué hace cada una y qué hacer al respecto, con los iconos de hechizo y retratos de jefes de Blizzard, y lo que Vigil vio en tu pull.",
  },
  {
    icon: "reports",
    title: "Toda la banda de un vistazo",
    body: "Un medidor de daño y sanación para tu grupo o banda con iconos de clase, cada muerte con su golpe final, y el daño de cada habilidad del jefe y a quién alcanzó.",
  },
  {
    icon: "upload",
    title: "Cada pull, analizado",
    body: "Cada combate terminado se sube a la web de tu hermandad, con reintentos si se cae la conexión, y se convierte en un informe con prioridad de rotación, tiempo activo de auras, reutilizaciones y una línea de tiempo. Tú eliges quién lo ve.",
  },
  {
    icon: "window",
    title: "Pensado para una segunda pantalla",
    body: "Una ventana estrecha junto al juego o una vista compacta fijada encima. Ciérrala y Vigil sigue subiendo desde la barra de menús o la bandeja del sistema, donde puedes pausar las subidas o abrir la web de tu hermandad.",
  },
  {
    icon: "privacy",
    title: "Lee el registro y nada más",
    body: "Vigil nunca toca el cliente del juego. Los combates se analizan en tu ordenador y solo se envía el informe. Es gratis y de código abierto con licencia AGPL-3.0, así que cualquiera puede comprobarlo.",
  },
];

function Faq({ release, platform }: { release: CompanionRelease | null; platform: CompanionPlatform | null }) {
  const items: { key: string; question: string; answer: ReactNode; open?: boolean }[] = [];
  const unsigned = (p: "mac" | "windows") => !release || (!release.signed[p] && primaryAsset(release, p) !== null);
  if (unsigned("mac")) {
    items.push({
      key: "mac",
      question: "macOS dice que Vigil no se puede abrir",
      open: platform === "mac",
      answer: (
        <>
          <p>
            Esta versión aún no está notarizada por Apple, así que macOS la bloquea la primera vez. Abre la imagen de disco y arrastra
            Vigil a Aplicaciones. Después haz clic derecho (o Control-clic) en Vigil dentro de Aplicaciones, elige Abrir y confirma con
            Abrir.
          </p>
          <p>
            En macOS 15 o posterior, intenta abrir Vigil una vez y luego ve a Ajustes del Sistema &gt; Privacidad y seguridad y pulsa
            Abrir igualmente. Hasta que las versiones estén notarizadas, Vigil no puede actualizarse solo en macOS; te avisa cuando sale
            una versión nueva.
          </p>
        </>
      ),
    });
  }
  if (unsigned("windows")) {
    items.push({
      key: "windows",
      question: "Windows dice que ha protegido mi PC",
      open: platform === "windows",
      answer: (
        <p>
          El instalador aún no tiene firma de código, así que Microsoft Defender SmartScreen puede avisarte. Pulsa Más información y
          luego Ejecutar de todas formas. A partir de ahí, las actualizaciones se instalan solas.
        </p>
      ),
    });
  }
  items.push(
    {
      key: "linux",
      question: "¿Cómo lo ejecuto en Linux?",
      answer: (
        <p>
          Descarga el AppImage, hazlo ejecutable (clic derecho, Propiedades, o <code className="text-gold">chmod +x</code> en una terminal)
          y ábrelo.
        </p>
      ),
    },
    {
      key: "safe",
      question: "¿Puede Vigil meter en problemas a mi cuenta?",
      answer: (
        <p>
          Vigil solo lee el archivo del registro de combate que el juego escribe en tu carpeta Logs. No inyecta nada, no automatiza nada
          y no se comunica con el juego. El addon opcional de Vigil, que puedes instalar desde los ajustes de la app, es un addon
          normal.
        </p>
      ),
    },
    {
      key: "pairing",
      question: "¿Dónde consigo un código de emparejamiento?",
      answer: (
        <p>
          Inicia sesión en la web de tu hermandad, abre Vigil, luego Conectar la app de Vigil, y crea un código. También puedes pulsar
          Abrir en la app para emparejar en un solo paso. Cada ordenador aparece en esa página, donde puedes revocarlo. ¿Aún no estás en
          ninguna hermandad de Guildbook?{" "}
          <Link href="/guilds" className={clsx("link", FOCUS)}>
            Busca una
          </Link>{" "}
          o{" "}
          <Link href="/create" className={clsx("link", FOCUS)}>
            crea la tuya
          </Link>
          .
        </p>
      ),
    },
  );
  return (
    <div className="space-y-3" data-testid="vigil-faq">
      {items.map((item) => (
        <details key={item.key} open={item.open} className="panel group overflow-hidden">
          <summary
            className={clsx(
              "flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-display text-sm font-semibold text-bone hover:text-gold [&::-webkit-details-marker]:hidden",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-bright",
            )}
          >
            {item.question}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" className="h-4 w-4 shrink-0 text-gold transition-transform group-open:rotate-45 motion-reduce:transition-none">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </summary>
          <div className="space-y-2 px-5 pb-5 text-sm leading-relaxed text-muted">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

function SectionHeading({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="mb-8 text-center">
      <h2 id={id} className="text-2xl font-semibold text-gold sm:text-3xl">
        {title}
      </h2>
      {lead && <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{lead}</p>}
    </div>
  );
}

export default async function VigilDownloadPage() {
  const h = await headers();
  const platform = detectPlatform(h.get("user-agent"), h.get("sec-ch-ua-platform"));
  const { ok, release } = await latestCompanionRelease();
  const released = release?.publishedAt ? formatDate(new Date(release.publishedAt), "UTC") : null;

  return (
    <div className="space-y-20 sm:space-y-24">
      <section aria-labelledby="vigil-title" className="grid items-center gap-12 pt-2 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <div className="flex items-center gap-5">
            <Image
              src="/brand/vigil/icon-512.png"
              alt="Icono de la app Vigil"
              width={96}
              height={96}
              priority
              className="h-20 w-20 drop-shadow-[0_0_30px_rgba(168,24,47,0.55)] sm:h-24 sm:w-24"
            />
            <div className="text-left">
              <p className="font-display text-xs tracking-[0.3em] text-gold/80 uppercase">App complementaria de Guildbook</p>
              <h1 id="vigil-title" className="mt-1 font-title text-5xl text-gold sm:text-6xl">
                Vigil
              </h1>
            </div>
          </div>
          <p className="mt-7 font-display text-xl text-bone sm:text-2xl">Vigila cada pull.</p>
          <hr className="rule-gold mt-5 w-48 lg:ml-0" />
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-bone/85">
            Vigil vigila tu registro de combate de World of Warcraft: Forever mientras juegas, te avisa de los fallos en cuanto ocurren, te
            explica cada jefe y sube cada combate de banda al Guildbook de tu hermandad para un análisis completo.
          </p>
          <div className="mt-8 w-full">
            {release ? <Downloads release={release} platform={platform} hero /> : <NoRelease ok={ok} hero />}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted lg:justify-start">
            <span className="inline-flex items-center gap-1.5">
              <GitHubIcon size={13} />
              Gratis y de código abierto,{" "}
              <External href={COMPANION_REPO_URL}>AGPL-3.0</External>
            </span>
            <External href={COMPANION_RELEASES_URL}>Ver todas las versiones</External>
          </div>
        </div>
        <AppScreenshot
          src={liveShot}
          alt="La ventana de Vigil durante una muerte de Ragnaros: puntuación en directo de 88 con uso del GCD, tiempo parado y amenaza por segundo, tiempo activo de Shield Block y Sunder Armor, información del jefe con las habilidades de Ragnaros y el daño de cada una, un medidor de daño del grupo con iconos de clase y una muerte por Wrath of Ragnaros."
          caption="Datos de demostración de una muerte sintética de Ragnaros."
          sizes="(min-width: 432px) 384px, calc(100vw - 3rem)"
          priority
          glow
          className="max-w-sm"
        />
      </section>

      <section aria-labelledby="how-heading">
        <SectionHeading id="how-heading" title="En marcha en tres pasos" lead="Unos minutos de configuración y Vigil vigila cada vez que juegas." />
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel flex flex-col items-center p-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold-dim bg-gold/5 font-display text-sm font-semibold text-gold">
                {["I", "II", "III"][i]}
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-bone">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="features-heading">
        <SectionHeading id="features-heading" title="Hecho para la noche de banda" lead="Todo lo que necesitas para aprender de cada pull, sin salir del combate con Alt+Tab." />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="panel p-5 transition-colors hover:border-gold-dim">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold-dim/60 bg-gold/10 text-gold shadow-[inset_0_1px_0_rgb(230_200_119/0.15)]">
                  {FEATURE_ICONS[f.icon]}
                </span>
                <h3 className="font-display text-base font-semibold text-gold">{f.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
        <div className="mx-auto mt-12 grid max-w-4xl items-start gap-10 sm:grid-cols-2">
          <AppScreenshot
            src={intelShot}
            alt="Información del jefe Ragnaros: su retrato y un resumen, y después Wrath of Ragnaros, Elemental Fire y Magma Blast, cada una con su icono de hechizo, etiquetas de rol, qué hace, qué hacer y el daño que hizo en el último combate."
            caption="Información del jefe Ragnaros. Datos de demostración."
            sizes="(min-width: 1024px) 428px, (min-width: 640px) calc(50vw - 3rem), calc(100vw - 3rem)"
            fade
            className="max-w-md"
          />
          <AppScreenshot
            src={detailShot}
            alt="Daño recibido por habilidad tras una muerte de Ragnaros: cada habilidad con su icono, daño total, golpes, jugadores alcanzados y muertes, y los jugadores alcanzados con sus iconos de clase."
            caption="Daño recibido en un combate terminado. Datos de demostración."
            sizes="(min-width: 1024px) 428px, (min-width: 640px) calc(50vw - 3rem), calc(100vw - 3rem)"
            className="max-w-md"
          />
        </div>
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted">
          Los iconos de hechizos y retratos de jefes son del World of Warcraft de Blizzard Entertainment. Vigil no tiene relación con
          Blizzard.
        </p>
      </section>

      <section aria-labelledby="faq-heading" className="mx-auto max-w-3xl">
        <SectionHeading id="faq-heading" title="Preguntas" />
        <Faq release={release} platform={platform} />
        <p className="mt-4 text-center text-sm text-muted">
          ¿Sigues atascado?{" "}
          <Link href="/support?category=vigil" className="text-gold underline-offset-2 hover:underline">
            Contacta con soporte
          </Link>
          .
        </p>
      </section>

      {release && (
        <section aria-labelledby="release-heading" className="grid items-start gap-4 lg:grid-cols-2">
          <h2 id="release-heading" className="sr-only">
            Versión {release.version}
          </h2>
          <div className="panel p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-gold">Novedades de la {release.version}</h3>
            {released && <p className="mt-1 text-xs text-muted">Publicada el {released}</p>}
            <div className="mt-4 text-sm">
              {release.notes ? <Markdown tone="dark">{release.notes}</Markdown> : <p className="text-muted">Esta versión no tiene notas.</p>}
            </div>
          </div>
          <div className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-gold">Todas las descargas</h3>
              <External href={release.url} className="text-sm">
                Versión en GitHub
              </External>
            </div>
            <ul className="mt-4 divide-y divide-line text-sm" data-testid="vigil-assets">
              {release.assets
                .filter((a) => a.platform)
                .map((a) => (
                  <li key={a.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <a href={a.url} className={clsx("link min-w-0 flex-1 break-all", FOCUS)}>
                      {a.name}
                    </a>
                    <span className="text-xs text-muted">
                      {a.kind} para {PLATFORM_LABELS[a.platform!]}
                    </span>
                    <span className="w-16 text-right text-xs text-muted tabular-nums">{formatBytes(a.size)}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Los canales de actualización y los block maps, que la app lee para actualizarse, están en la{" "}
              <External href={release.url}>página de la versión</External>.
            </p>
          </div>
        </section>
      )}

      <section className="panel relative overflow-hidden px-6 py-12 text-center">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(168_24_47/0.18),transparent_65%)]" />
        <div className="relative flex flex-col items-center">
          <Image src="/brand/vigil/icon-512.png" alt="" width={56} height={56} className="h-14 w-14" />
          <h2 className="mt-4 font-title text-2xl text-gold sm:text-3xl">Vigila esta misma noche</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
            Instala Vigil antes de tu próxima banda y cada pull llegará a la web de tu hermandad, listo para analizar.
          </p>
          <div className="mt-6 flex justify-center">
            {release ? <Downloads release={release} platform={platform} /> : <NoRelease ok={ok} />}
          </div>
          {release && (
            <p className="mt-6 text-xs text-muted">
              Vigil {release.version}
              {released && `, publicada el ${released}`}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
