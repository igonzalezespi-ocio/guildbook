import { ConfirmDeleteForm } from "@/components/confirm-delete-form";
import { Panel } from "@/components/ui";
import { db } from "@/db";
import type { Actor } from "@/lib/authz/policy";
import { deleteGuildAction } from "@/server/actions/account";
import { canDeleteGuild } from "@/server/services/account";

/** Owner-only danger zone at the bottom of guild settings. */
export async function DeleteGuildPanel({ slug, name, actor }: { slug: string; name: string; actor: Actor }) {
  if (!(await canDeleteGuild(db, actor))) return null;
  if (process.env.DEFAULT_GUILD_SLUG && process.env.DEFAULT_GUILD_SLUG === slug) return null;
  return (
    <Panel title="Borrar esta hermandad" className="border-red-900/60">
      <div className="space-y-3 text-sm text-muted" data-testid="delete-guild">
        <p>
          Borra para siempre {name} y todo lo que contiene: miembros, personajes, solicitudes, páginas, horario, progreso,
          informes de Vigil, dominios propios y el registro de auditoría. Los miembros conservan sus cuentas de Guildbook. No se puede deshacer.
        </p>
        <ConfirmDeleteForm
          action={deleteGuildAction.bind(null, slug)}
          expected={name}
          buttonLabel="Borrar hermandad"
          pendingLabel="Borrando…"
        />
      </div>
    </Panel>
  );
}
