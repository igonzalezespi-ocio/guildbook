import type { Metadata } from "next";
import { CharacterForm } from "@/components/character-form";
import { PageHeader, Panel } from "@/components/ui";
import { guildHref } from "@/lib/paths";
import { createCharacterAction } from "@/server/actions/member";
import { requirePage } from "@/server/context";

export const metadata: Metadata = { title: "Registrar personaje" };

export default async function NewCharacterPage({ params }: PageProps<"/[guild]/members/characters/new">) {
  const { guild: slug } = await params;
  const { guild } = await requirePage(slug, "character.manageOwn", guildHref(slug, "/members/characters/new"));
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Registrar personaje" />
      <Panel>
        <CharacterForm action={createCharacterAction.bind(null, slug)} submitLabel="Registrar" showFaction={!guild.faction} gameVersion={guild.gameVersion} />
      </Panel>
    </div>
  );
}
