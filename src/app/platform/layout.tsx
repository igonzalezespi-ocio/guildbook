import type { Metadata } from "next";
import Link from "next/link";
import { GitHubIcon } from "@/components/github-icon";
import { GuildbookWordmark } from "@/components/guildbook-mark";
import { XIcon } from "@/components/x-icon";
import { db } from "@/db";
import { brandIcons, brandPreviewImage, GUILDBOOK_DESCRIPTION, SOURCE_URL, X_URL } from "@/lib/brand";
import { getSessionUser } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { listUserGuilds } from "@/server/services/platform";
import { PlatformAccountMenu } from "./account-menu";

/** The platform apex (guildbook.io). The proxy rewrites apex paths here; this segment is never linked directly. */
export async function generateMetadata(): Promise<Metadata> {
  const current = await getRequestHost();
  const image = brandPreviewImage("guildbook");
  return {
    metadataBase: new URL(current.apexOrigin),
    title: { absolute: "Guildbook: webs de hermandad para World of Warcraft: Forever", template: "%s | Guildbook" },
    description: GUILDBOOK_DESCRIPTION,
    applicationName: "Guildbook",
    icons: brandIcons("guildbook"),
    openGraph: { type: "website", siteName: "Guildbook", title: "Guildbook", description: GUILDBOOK_DESCRIPTION, url: "/", images: [image] },
    twitter: { card: "summary_large_image", title: "Guildbook", description: GUILDBOOK_DESCRIPTION, images: [image] },
  };
}

export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const [user, current] = await Promise.all([getSessionUser(), getRequestHost()]);
  const myGuilds = user ? await listUserGuilds(db, user.id) : [];
  const year = new Date().getFullYear();

  return (
    <div className="platform flex min-h-screen flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="Inicio de Guildbook">
            <GuildbookWordmark />
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-3 sm:gap-5">
            <Link href="/guilds" className="font-display text-sm tracking-wider text-bone hover:text-gold">
              Directorio
            </Link>
            <Link href="/create" className="btn btn-gold btn-sm hidden sm:inline-flex">
              Crea una hermandad
            </Link>
            {user ? (
              <PlatformAccountMenu
                user={user}
                guilds={myGuilds}
                guildHref={(g, path = "") => `${guildOrigin(g.slug, current, g.customDomain)}${path}`}
              />
            ) : (
              <Link href="/login" className="btn btn-ghost btn-sm">
                Iniciar sesión
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-12">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center">
          <GuildbookWordmark />
          <p className="text-xs text-muted">
            &copy; {year} Guildbook. Webs de hermandad hechas por fans, sin relación con Blizzard Entertainment. World of Warcraft
            es una marca registrada de Blizzard Entertainment, Inc.
          </p>
          <nav aria-label="Información legal" className="flex flex-wrap justify-center gap-4 text-xs">
            <Link href="/vigil" className="text-bone/70 hover:text-gold">
              App Vigil
            </Link>
            <Link href="/terms" className="text-bone/70 hover:text-gold">
              Términos del servicio
            </Link>
            <Link href="/privacy" className="text-bone/70 hover:text-gold">
              Política de privacidad
            </Link>
            <Link href="/support" className="text-bone/70 hover:text-gold">
              Soporte
            </Link>
            <a
              href={SOURCE_URL}
              aria-label="Código fuente en GitHub"
              className="inline-flex items-center gap-1.5 text-bone/70 hover:text-gold"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon size={13} />
              Código fuente
            </a>
            <a
              href={X_URL}
              aria-label="Guildbook en X"
              className="inline-flex items-center gap-1.5 text-bone/70 hover:text-gold"
              target="_blank"
              rel="noopener noreferrer"
            >
              <XIcon size={12} />
              @GuildbookIO
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
