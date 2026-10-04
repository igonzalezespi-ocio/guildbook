import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { DEFAULT_GUILD_VERSION, isSupportedVersion } from "@/lib/game-versions";
import { getSessionUser } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { CreateGuildForm } from "./create-guild-form";

export const metadata: Metadata = { title: "Crea tu hermandad" };

const SLUG_TOKEN = "slug-token";

export default async function CreateGuildPage({ searchParams }: PageProps<"/platform/create">) {
  const { version } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login?callbackUrl=%2Fcreate");
  const current = await getRequestHost();
  const [hostPrefix, hostSuffix] = guildOrigin(SLUG_TOKEN, current).replace(/^https?:\/\//, "").split(SLUG_TOKEN) as [string, string];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Crea tu hermandad" eyebrow="Guildbook">
        Tu hermandad tendrá su propia web y su subdominio. Tú serás su maestro de la hermandad y podrás cambiarlo todo más adelante.
      </PageHeader>
      <Panel>
        <CreateGuildForm hostPrefix={hostPrefix} hostSuffix={hostSuffix} initialVersion={isSupportedVersion(version) ? version : DEFAULT_GUILD_VERSION} />
      </Panel>
    </div>
  );
}
