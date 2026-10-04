/**
 * The Vigil companion's GitHub releases, as the download page shows them. The companion lives in its own repository
 * and releases are tagged `v<version>`; its release workflow writes a signing marker into the notes so the page knows
 * whether to explain Gatekeeper or SmartScreen.
 */

export const COMPANION_REPO = "Guildbook/vigil";
export const COMPANION_REPO_URL = `https://github.com/${COMPANION_REPO}`;
export const COMPANION_RELEASES_URL = `${COMPANION_REPO_URL}/releases`;
/** `v0.1.0`, `v1.2.3-beta.1` and so on; the version is what follows the `v`. */
const COMPANION_TAG = /^v(\d+\.\d+\.\d+\S*)$/;

export type CompanionPlatform = "mac" | "windows" | "linux";

export const PLATFORM_LABELS: Record<CompanionPlatform, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };

/** The subset of GitHub's release JSON the page reads. */
export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string; size: number; browser_download_url: string }[];
}

export interface CompanionAsset {
  name: string;
  size: number;
  url: string;
  platform: CompanionPlatform | null;
  /** What the file is for, in a few words. */
  kind: string;
  /** The file to offer on the big button for its platform. */
  primary: boolean;
}

export interface CompanionRelease {
  version: string;
  tag: string;
  url: string;
  publishedAt: string | null;
  /** Release notes as Markdown, without the signing marker. */
  notes: string;
  /** Unknown platforms (no marker) count as unsigned, so the page errs on the side of explaining. */
  signed: Record<"mac" | "windows", boolean>;
  assets: CompanionAsset[];
}

/** `<!-- vigil-signing: mac=signed windows=unsigned -->` */
const SIGNING_MARKER = /<!--\s*vigil-signing:([^>]*?)-->/i;

export function parseSigning(body: string | null): Record<"mac" | "windows", boolean> {
  const values = new Map<string, string>();
  for (const pair of SIGNING_MARKER.exec(body ?? "")?.[1]?.trim().split(/\s+/) ?? []) {
    const [key, value] = pair.split("=");
    if (key && value) values.set(key.toLowerCase(), value.toLowerCase());
  }
  return { mac: values.get("mac") === "signed", windows: values.get("windows") === "signed" };
}

function classify(name: string): Pick<CompanionAsset, "platform" | "kind" | "primary"> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".blockmap")) return { platform: null, kind: "Datos de actualización", primary: false };
  if (/^latest.*\.yml$/.test(lower)) return { platform: null, kind: "Canal de actualizaciones", primary: false };
  if (lower.endsWith(".dmg")) return { platform: "mac", kind: "Imagen de disco", primary: true };
  if (lower.endsWith(".zip") && lower.includes("mac")) return { platform: "mac", kind: "Archivo zip", primary: false };
  if (lower.endsWith(".exe")) return { platform: "windows", kind: "Instalador", primary: true };
  if (lower.endsWith(".appimage")) return { platform: "linux", kind: "AppImage", primary: true };
  return { platform: null, kind: "Archivo", primary: false };
}

const PLATFORM_ORDER: (CompanionPlatform | null)[] = ["mac", "windows", "linux", null];

/** The newest published companion release in GitHub's list (newest first), or null. */
export function pickCompanionRelease(releases: GitHubRelease[]): CompanionRelease | null {
  const release = releases.find((r) => !r.draft && !r.prerelease && COMPANION_TAG.test(r.tag_name));
  if (!release) return null;
  const assets = release.assets
    .map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, ...classify(a.name) }))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || Number(b.primary) - Number(a.primary));
  return {
    version: COMPANION_TAG.exec(release.tag_name)![1]!,
    tag: release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at,
    notes: (release.body ?? "").replace(SIGNING_MARKER, "").trim(),
    signed: parseSigning(release.body),
    assets,
  };
}

export function primaryAsset(release: CompanionRelease, platform: CompanionPlatform): CompanionAsset | null {
  return release.assets.find((a) => a.platform === platform && a.primary) ?? null;
}

/**
 * The visitor's desktop OS from Client Hints or the user agent, or null on phones, tablets and unknown systems.
 * iPads that ask for the desktop site look like Macs; the page still lists every download.
 */
export function detectPlatform(userAgent: string | null, platformHint?: string | null): CompanionPlatform | null {
  const hint = platformHint?.replace(/"/g, "").toLowerCase();
  if (hint === "macos") return "mac";
  if (hint === "windows") return "windows";
  if (hint === "linux") return "linux";
  if (hint === "chrome os" || hint === "android" || hint === "ios") return null;
  const ua = userAgent ?? "";
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return null;
  if (/windows nt/i.test(ua)) return "windows";
  if (/macintosh|mac os x/i.test(ua)) return "mac";
  if (/cros/i.test(ua)) return null;
  if (/linux|x11/i.test(ua)) return "linux";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
