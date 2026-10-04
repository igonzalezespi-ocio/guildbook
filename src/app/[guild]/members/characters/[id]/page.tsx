import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CharacterForm } from "@/components/character-form";
import { PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { fullName } from "@/lib/game";
import { guildHref } from "@/lib/paths";
import { updateCharacterAction } from "@/server/actions/member";
import { requirePage } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getOwnCharacter } from "@/server/services/characters";

export const metadata: Metadata = { title: "Editar personaje" };

export default async function EditCharacterPage({ params }: PageProps<"/[guild]/members/characters/[id]">) {
  const { guild: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { guild, actor } = await requirePage(slug, "character.manageOwn", guildHref(slug, `/members/characters/${id}`));
  const character = await getOwnCharacter(db, actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Editar a ${fullName(character.name, character.surname)}`} />
      <Panel>
        <CharacterForm action={updateCharacterAction.bind(null, slug, id)} 
          character={character}
          submitLabel="Guardar"
          showFaction={!guild.faction}
          gameVersion={guild.gameVersion}
        />
      </Panel>
    </div>
  );
}
