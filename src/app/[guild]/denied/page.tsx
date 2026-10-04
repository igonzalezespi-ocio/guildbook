import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { guildHref } from "@/lib/paths";

export default async function DeniedPage({ params }: PageProps<"/[guild]/denied">) {
  const { guild: slug } = await params;
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="La puerta está cerrada" />
      <Panel>
        <p className="mb-4">Tu rango no da acceso a esa página.</p>
        <Link href={guildHref(slug, "/")} className="btn btn-ghost">
          Volver al inicio
        </Link>
      </Panel>
    </div>
  );
}
