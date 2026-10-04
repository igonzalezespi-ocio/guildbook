import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { MarkdownEditor } from "@/components/markdown-editor";
import { PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { guildHref } from "@/lib/paths";
import { updateContentAction } from "@/server/actions/admin";
import { requirePage } from "@/server/context";
import { getContentPage } from "@/server/services/content";

export const metadata: Metadata = { title: "Editar página" };

export default async function EditContentPage({ params }: PageProps<"/[guild]/admin/content/[slug]">) {
  const { guild: slug, slug: pageSlug } = await params;
  const { guild } = await requirePage(slug, "content.edit", guildHref(slug, `/admin/content/${pageSlug}`));
  const page = await getContentPage(db, guild.id, pageSlug);
  if (!page) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Editar: ${page.title}`} />
      <Panel>
        <ActionForm action={updateContentAction.bind(null, slug)} className="space-y-4">
          <input type="hidden" name="slug" value={page.slug} />
          <Field label="Título" name="title">
            <input id="title" name="title" className="field" defaultValue={page.title} required />
          </Field>
          <Field label="Texto (Markdown)" name="bodyMd">
            <MarkdownEditor name="bodyMd" defaultValue={page.bodyMd} />
          </Field>
          <FormMessage />
          <SubmitButton>Guardar página</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
