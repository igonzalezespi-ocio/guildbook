import { testModeEnabled } from "@/auth";
import { db } from "@/db";
import { Tag } from "@/components/ui";
import { signInForTests } from "@/server/actions/member";
import { listTestAccounts, nextRecruitId, type TestAccount } from "@/server/test-accounts";

const GROUP_LABELS: Record<TestAccount["group"], string> = {
  member: "Miembros",
  applicant: "Aspirantes",
  other: "Otras cuentas de prueba",
};

function QuickPick({ account, callbackUrl }: { account: Pick<TestAccount, "discordId" | "name" | "displayName" | "standing">; callbackUrl: string }) {
  return (
    <li>
      <form action={signInForTests}>
        <input type="hidden" name="discordId" value={account.discordId} />
        <input type="hidden" name="name" value={account.name} />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button
          type="submit"
          aria-label={`${account.displayName}, ${account.standing} (${account.discordId})`}
          className="block w-full rounded px-3 py-2 text-left transition-colors hover:bg-ink-3 focus-visible:bg-ink-3 focus-visible:outline-2 focus-visible:outline-gold-dim"
        >
          <span className="block text-sm font-semibold text-bone">{account.displayName}</span>
          <span className="block text-xs text-muted">
            {account.standing} <span className="font-mono text-gold-dim">({account.discordId})</span>
          </span>
        </button>
      </form>
    </li>
  );
}

/** Test-mode sign-in: one click as any seeded account, a fresh recruit, or a custom Discord ID. */
export async function TestLogin({
  guildId,
  callbackUrl,
  currentName,
}: {
  /** The guild whose standing labels the seeded accounts. Null (the platform apex) lists no seeded accounts. */
  guildId: string | null;
  callbackUrl: string;
  /** Null when signed out. */
  currentName: string | null;
}) {
  if (!testModeEnabled) return null;
  const [accounts, recruitId] = await Promise.all([guildId ? listTestAccounts(db, guildId) : [], nextRecruitId(db)]);
  const recruitNumber = recruitId.slice("recruit-".length);
  const groups = (["member", "applicant", "other"] as const)
    .map((group) => ({ group, accounts: accounts.filter((a) => a.group === group) }))
    .filter((g) => g.accounts.length > 0);

  return (
    <div className="mt-6 w-full space-y-3 border-t border-line pt-4 text-left" data-testid="test-login">
      <div className="flex items-center justify-center gap-2">
        <Tag>Modo de prueba</Tag>
        <p className="text-xs text-muted">Elige una cuenta para iniciar sesión</p>
      </div>
      {currentName !== null && (
        <p className="text-center text-xs text-bone" data-testid="test-login-current">
          Sesión iniciada como {currentName}. Si vuelves a iniciar sesión, cambias de cuenta.
        </p>
      )}

      <div className="max-h-80 overflow-y-auto rounded border border-line bg-ink" data-testid="test-login-accounts">
        <ul className="divide-y divide-line">
          <QuickPick
            account={{ discordId: recruitId, name: `Recruit ${recruitNumber}`, displayName: "Nuevo recluta", standing: "Cuenta sin usar" }}
            callbackUrl={callbackUrl}
          />
        </ul>
        {groups.map(({ group, accounts }) => (
          <section key={group} aria-label={GROUP_LABELS[group]}>
            <h3 className="sticky top-0 border-y border-line bg-ink-2 px-3 py-1 text-[0.65rem] tracking-wider text-gold-dim uppercase">
              {GROUP_LABELS[group]}
            </h3>
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <QuickPick key={account.discordId} account={account} callbackUrl={callbackUrl} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <form action={signInForTests} className="space-y-2" data-testid="test-login-other">
        <label className="field-label" htmlFor="test-login-discord-id">
          Otro ID
        </label>
        <div className="flex gap-2">
          <input id="test-login-discord-id" name="discordId" placeholder="ID de Discord" className="field" autoComplete="off" required />
          <input name="name" placeholder="Nombre" aria-label="Nombre" className="field" autoComplete="off" required />
        </div>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button type="submit" className="btn btn-ghost w-full">
          Entrar (prueba)
        </button>
      </form>
    </div>
  );
}
