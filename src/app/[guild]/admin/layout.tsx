import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { can } from "@/lib/authz/policy";
import { guildHref } from "@/lib/paths";
import { dismissAdminNoticeAction } from "@/server/actions/verification";
import { getGuild, getViewer } from "@/server/context";
import { AdminNav } from "./admin-nav";

/** Navigation only. Each admin page and service enforces its own permission. */
export default async function AdminLayout({ children, params }: LayoutProps<"/[guild]/admin">) {
  const { guild: slug } = await params;
  const guild = await getGuild(slug);
  const viewer = await getViewer(guild.id);
  const h = (p: string) => guildHref(slug, `/admin${p}`);
  const links: { href: string; label: string; exact?: boolean }[] = [
    { href: h(""), label: "Resumen", exact: true },
    ...(can(viewer.actor, "guild.settings") ? [{ href: h("/setup"), label: "Configuración" }] : []),
    { href: h("/applications"), label: "Solicitudes" },
    { href: h("/members"), label: "Miembros" },
    ...(can(viewer.actor, "rank.manage") ? [{ href: h("/ranks"), label: "Rangos" }] : []),
    { href: h("/content"), label: "Reglamento" },
    { href: h("/schedule"), label: "Horario" },
    { href: h("/recruitment"), label: "Reclutamiento" },
    { href: h("/progression"), label: "Progreso" },
    ...(can(viewer.actor, "loot.award") ? [{ href: h("/loot"), label: "Botín" }] : []),
    ...(can(viewer.actor, "guild.settings") ? [{ href: h("/guild"), label: "Hermandad" }] : []),
  ];
  const more = [
    { href: h("/addons"), label: "Addons" },
    { href: h("/audit"), label: "Registro de auditoría" },
  ];

  return (
    <div>
      {can(viewer.actor, "admin.area") && (
        <AdminNav links={links} more={more} />
      )}
      {guild.adminNotice && can(viewer.actor, "admin.area") && (
        <aside
          role="status"
          className="mx-auto mb-6 max-w-3xl space-y-2 rounded border border-gold-dim/60 bg-gold/5 px-4 py-3 text-sm text-bone"
          data-testid="admin-notice"
        >
          <p className="font-display text-xs tracking-[0.2em] text-gold uppercase">Aviso de Guildbook</p>
          {guild.adminNotice.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i} className="leading-relaxed">
              {paragraph}
            </p>
          ))}
          {can(viewer.actor, "guild.settings") && (
            <ActionForm action={dismissAdminNoticeAction.bind(null, slug)}>
              <SubmitButton size="sm" variant="ghost">
                Descartar
              </SubmitButton>
              <FormMessage className="mt-2" />
            </ActionForm>
          )}
        </aside>
      )}
      {children}
    </div>
  );
}
