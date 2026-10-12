"use client";

import { useState, useTransition } from "react";
import { createAddonSyncTokenAction, type SyncTokenResult } from "@/server/actions/addon-sync";

/** Creates a sync key and shows it once, with a copy button: the site keeps only its hash. */
export function SyncTokenCreator({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [result, setResult] = useState<SyncTokenResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const token = result?.ok ? result.token : null;

  const create = () =>
    startTransition(async () => {
      setCopied(false);
      setResult(await createAddonSyncTokenAction(slug, name || "Sincronizador"));
      setName("");
    });

  return (
    <div className="space-y-4">
      {token && (
        <div className="rounded border border-gold-dim bg-ink/40 p-4" data-testid="addon-sync-token">
          <p className="text-xs tracking-widest text-muted uppercase">Tu clave nueva</p>
          <p className="my-2 font-mono text-sm break-all text-gold-bright select-all" aria-label="Clave del sincronizador">
            {token}
          </p>
          <p className="text-sm text-muted">Cópiala ahora y pégala en el sincronizador: no se volverá a mostrar.</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-3"
            onClick={async () => {
              await navigator.clipboard.writeText(token);
              setCopied(true);
            }}
          >
            {copied ? "Copiada" : "Copiar clave"}
          </button>
        </div>
      )}
      {result && !result.ok && (
        <p role="alert" className="text-sm text-red-300">
          {result.error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-sm text-muted">Nombre (para reconocerla, por ejemplo el ordenador)</span>
          <input className="field" value={name} maxLength={80} placeholder="Sobremesa de casa" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={create} disabled={pending}>
          {pending ? "Creando…" : "Crear clave"}
        </button>
      </div>
    </div>
  );
}
