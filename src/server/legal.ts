import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { applicationRetentionDays } from "@/server/services/account";

export type LegalDoc = "terms" | "privacy";

export interface LegalPage {
  title: string;
  updated: string | null;
  body: string;
}

/**
 * Reads a policy from src/content/legal (bundled via outputFileTracingIncludes in next.config.ts). The leading
 * `# Title` and `Last updated:` line become the page header; placeholders such as [CONTACT EMAIL] stay visible.
 * `{{applicationRetentionDays}}` is filled from APPLICATION_RETENTION_DAYS so the policy matches the cleanup job.
 */
export const readLegal = cache(async (doc: LegalDoc): Promise<LegalPage> => {
  const raw = (await readFile(path.join(process.cwd(), "src/content/legal", `${doc}.md`), "utf8")).replaceAll(
    "{{applicationRetentionDays}}",
    String(applicationRetentionDays()),
  );
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let title = doc === "terms" ? "Términos del servicio" : "Política de privacidad";
  let updated: string | null = null;
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const heading = /^#\s+(.+)$/.exec(lines[0] ?? "");
  if (heading) {
    title = heading[1]!.replace(/^Guildbook\s+/, "");
    lines.shift();
  }
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const stamp = /^(?:Last updated|Última actualización):\s*(.+)$/i.exec(lines[0] ?? "");
  if (stamp) {
    updated = stamp[1]!.trim();
    lines.shift();
  }
  return { title, updated, body: lines.join("\n").trim() };
});
