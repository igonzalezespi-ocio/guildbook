> **This is a fork** of [Guildbook](https://github.com/Guildbook/guildbook), adapted to run one guild on a
> self-hosted server (Podman). Same licence (AGPL-3.0-only); our changes are published here. Changes so far:
> a production container image (`Containerfile`) published to GHCR, test-only switches that refuse to run on
> any production server (not only on Vercel), and a secret scan in CI.

<p align="center">
  <a href="https://guildbook.io"><img src="public/brand/guildbook/social/x-header.png" alt="Guildbook: guild sites for World of Warcraft: Forever" width="100%"></a>
</p>

<p align="center">
  <a href="https://github.com/Guildbook/guildbook/actions/workflows/ci.yml"><img src="https://github.com/Guildbook/guildbook/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
  <a href="https://guildbook.io"><img src="https://img.shields.io/website?url=https%3A%2F%2Fguildbook.io&label=guildbook.io" alt="guildbook.io"></a>
  <a href="https://github.com/Guildbook/vigil/releases/latest"><img src="https://img.shields.io/github/v/release/Guildbook/vigil?include_prereleases&sort=semver&label=Vigil" alt="Latest Vigil release"></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16"></a>
  <a href="https://x.com/GuildbookIO"><img src="https://img.shields.io/badge/follow-%40GuildbookIO-black?logo=x" alt="Follow @GuildbookIO on X"></a>
</p>

# Guildbook

**Guildbook is a home for World of Warcraft: Forever guilds.** Every guild gets its own site at `yourguild.guildbook.io`, with its charter and lore, a roster of Battle.net-verified characters, applications, raid nights and progression, a loot ledger, combat log reviews through Vigil, and a theme drawn from the guild's in-game tabard. It's free, and one Discord sign-in works for every guild.

See it live at [osm.guildbook.io](https://osm.guildbook.io), home of the Order of Saint Michael, or start your own at [guildbook.io](https://guildbook.io).

## What a guild site includes

- **Your own address.** A subdomain like `yourguild.guildbook.io`, and your own domain if you want one.
- **Charter and lore.** Markdown pages for your rules, loot policy and story, with a full revision history.
- **Roster and ranks.** Your rank ladder, mains and alts, professions, and per-rank permissions in the admin.
- **Applications.** Recruits sign in with Discord, pick a character verified through Battle.net (or enter one by hand) and apply. Officers review in the admin.
- **Raid nights.** Schedule, recruitment needs and boss progression, shown in your guild's timezone.
- **Loot ledger.** An append-only record of who got what, with imports from Gargul, RCLootCouncil and TMB. Members-only by default, or public if you choose.
- **Vigil.** Members upload combat logs for a private review of each pull: rotation, uptimes and cooldowns.
- **Tabard theming.** Pick your in-game emblem and colors from the game's own designer set (or import them from your guild once WoW: Forever launches) on a Guildbook banner, and the site takes them on.
- **Audit log.** Every officer action is recorded and can't be edited.

## For guild leaders

1. Sign in at [guildbook.io](https://guildbook.io) with Discord.
2. Go to [guildbook.io/create](https://guildbook.io/create) and choose a name, subdomain, faction, ruleset and timezone. Your site is live immediately, and you're its Guild Master.
3. Fill in your charter, ranks, schedule and recruitment needs from the admin, then share the link.

**Region, faction and ruleset.** Battle.net regions (Americas and Europe) are separate worlds: characters, guilds and names exist per region. WoW: Forever has no realms: each guild lives in one region, on one ruleset (Normal, PvP, Roleplaying, or Hardcore once it opens after launch) and with one faction. Name, region, faction and ruleset together identify a guild on Guildbook, and only one guild can hold each combination, so guild names are unique per region, faction and ruleset.

**Verification.** Names and subdomains of unverified guilds are first come, first served. A guild becomes **verified** when its in-game Guild Master links Battle.net and proves they lead the in-game guild with that name, faction and ruleset in the guild's region. A verified Guild Master can claim their guild's name, or the matching subdomain, from an unverified guild; that guild is renamed or moved to a numbered subdomain, keeps its members and content, and its admins are told why. A verified guild's name can't be claimed. Guildbook re-checks verification daily and removes it after a week of failed checks. Verification needs WoW: Forever characters, so it opens when the game launches on November 4, 2026. The full policy is in the [Terms](https://guildbook.io/terms).

## For members

- **Sign in with Discord.** One Guildbook account for every guild, with no password.
- **Link Battle.net** (optional) from Apply or My Characters to import your WoW: Forever characters. Their name, class and level come from Blizzard and show as verified to officers, and levels stay in sync. Characters entered by hand are marked unverified.
- **Apply** from your guild's Apply page, and follow your application from there.
- **Get Vigil** at [guildbook.io/vigil](https://guildbook.io/vigil). The desktop companion watches your combat log on a second screen, shows live rotation callouts and uploads each fight to your guild. It only reads the log file on disk; it never touches the game. Source and releases: [Guildbook/vigil](https://github.com/Guildbook/vigil).
- **Your data.** Export or delete your account from your account page. See the [Privacy Policy](https://guildbook.io/privacy).

## Links

| | |
|---|---|
| Guildbook | [guildbook.io](https://guildbook.io) |
| Guild directory | [guildbook.io/guilds](https://guildbook.io/guilds) |
| Showcase guild | [osm.guildbook.io](https://osm.guildbook.io) (Order of Saint Michael) |
| Vigil companion | [guildbook.io/vigil](https://guildbook.io/vigil) and [Guildbook/vigil](https://github.com/Guildbook/vigil) |
| Updates | [@GuildbookIO on X](https://x.com/GuildbookIO) |
| Legal | [Terms](https://guildbook.io/terms) and [Privacy](https://guildbook.io/privacy) |

## Self-hosting and development

Guildbook is built with Next.js 16 (App Router, strict TypeScript), Tailwind CSS v4, Postgres with Drizzle ORM, Auth.js (Discord), Zod, Vitest and Playwright. The hosted service runs on Vercel with Neon Postgres. The Order of Saint Michael, Guildbook's first guild, keeps its own crest, ranks, prayer and lore through the `order` preset; new guilds start from a neutral template.

### Setup

Requirements: Node 22+, pnpm 10+, Docker (or any Postgres 15+).

```bash
pnpm install
cp .env.example .env.local        # then fill in the values below
pnpm db:up                        # local Postgres 17 on port 5434 (docker compose)
pnpm db:migrate                   # apply all migrations
pnpm db:seed                      # demo guild: 25 members, raids, applicants, addons
pnpm dev                          # apex http://localhost:3000, the Order http://osm.localhost:3000
```

`pnpm db:reseed` wipes and recreates the demo guild.

Local hosts (no `/etc/hosts` edits needed; browsers resolve `*.localhost` to your machine):

| URL | Serves |
|---|---|
| `http://localhost:3000` | The Guildbook apex: landing, sign-in, create a guild, directory (like `guildbook.io`) |
| `http://www.localhost:3000` | Redirects to `http://localhost:3000`, keeping the path (like `www.guildbook.io`) |
| `http://osm.localhost:3000` | The Order of Saint Michael on its subdomain (like `osm.guildbook.io`); any `{slug}.localhost` is that guild |

Sign-in always happens on `localhost:3000`, where the Discord redirect URI is registered, and hands the session to `*.localhost` (see Sign-in below).

#### Signing in locally without a Discord app

Set `AUTH_TEST_MODE=1` in `.env.local`. The login page (`http://osm.localhost:3000/login` sends you to the apex login with the Order as the destination) then shows a test form. Pick a seeded account or enter a seeded Discord ID to sign in as that member:

| Discord ID | Rank | Tier |
|---|---|---|
| `seed-tor` | Grand Master | Admin |
| `seed-ironvow` | Marshal | Officer |
| `seed-cassian` | Knight | Raider |
| `seed-perpetua` | Squire | Member |
| `seed-joanofarc` | Postulant (pending application) | Applicant |

Any other ID creates a new user with no membership. Test mode must never be enabled in production; the app refuses to start if `AUTH_TEST_MODE=1` and `VERCEL_ENV=production`.

#### Discord OAuth

1. Create an application at <https://discord.com/developers/applications>.
2. Under **OAuth2**, add redirect URIs `http://localhost:3000/api/auth/callback/discord` and `https://guildbook.io/api/auth/callback/discord`. Guild subdomains and custom domains never run OAuth themselves; they send sign-in to the apex, so no per-guild URIs are needed.
3. Copy the client ID and secret into `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`.

#### Battle.net character verification

Members sign in with Discord. Battle.net is linked afterwards, from Apply or My Characters, so applicants can pick a character whose name, class and level come from Blizzard (officers see **Verified via Battle.net**), and members can import verified characters whose levels sync automatically. Manual entry always remains and is marked **Unverified**.

1. Sign in at <https://develop.battle.net/access/clients> and choose **Create client**.
2. Add redirect URLs `http://localhost:3000/api/battlenet/callback` and `https://guildbook.io/api/battlenet/callback`. Linking started on a guild subdomain or custom domain bounces to the apex and returns to the guild afterwards (the return URL is checked against the same allowlist as sign-in). The redirect URI must match exactly; set `BATTLENET_REDIRECT_URI=https://guildbook.io/api/battlenet/callback` in production.
3. Copy the client ID and secret into `BATTLENET_CLIENT_ID` and `BATTLENET_CLIENT_SECRET`. One client works for every region: OAuth is global (`oauth.battle.net`) and API calls go to `us.api.blizzard.com` or `eu.api.blizzard.com` per region.
4. Set `BATTLENET_TOKEN_KEY` to `openssl rand -base64 32`. Access tokens are stored AES-256-GCM encrypted with it.
5. Set `CRON_SECRET` (`openssl rand -hex 32`) in Vercel. `vercel.json` schedules `/api/cron/daily`, which deletes withdrawn and declined applications older than `APPLICATION_RETENTION_DAYS` and then runs the level sync; Vercel sends the secret as a Bearer token.

How it works:
- The OAuth flow (`/api/battlenet/link` then `/api/battlenet/callback`, scope `wow.profile`) links the Battle.net account to the signed-in user. It is not a login method.
- Blizzard access tokens last about 24 hours and there is no refresh token. At link time we snapshot the account's characters; applications and imports are verified against that stored snapshot, never against what the browser sends. While the token is valid, "Refresh characters" re-reads the list; after that, "Reconnect" runs the OAuth flow again.
- **Regions.** A Battle.net account can have characters in the Americas and in Europe. Linking reads every region in `BATTLENET_REGIONS` (default `us,eu`) and tags each character with its region; a region that answers 403 or 404 (no licence there) or fails doesn't hide the other's characters. A guild only offers, imports and verifies characters in its own region, and guild verification and the daily re-check look characters up in the guild's region. Snapshots taken before regions have no region on their characters and count as US.
- The level sync (daily cron and the officer **Sync now** button on Admin, Members) uses an app (client-credentials) token and public profile lookups in each character's region, or one guild-roster request when `BATTLENET_GUILD_REALM` and `BATTLENET_GUILD_SLUG` are set (for guilds in `BATTLENET_GUILD_REGION`). It doesn't need the member's token.
- Battle.net doesn't expose WoW: Forever surnames (as far as we know), so the surname stays editable text. If the API starts returning one, it's used and locked.
- Link, unlink, refresh, import and sync are written to the audit log.

**Which characters count as WoW: Forever.** Blizzard keeps each game's characters in its own profile namespace, and hasn't published one for Forever yet. It may be `profile-classic1x-{region}` (the default, shared with Classic Era, Hardcore and Season of Discovery), `profile-classic-{region}`, or a new one. Namespace settings are per region: write them as `{region}` templates, as region-agnostic bases (`profile-classic1x`, which gets `-us` or `-eu` appended), or as before regions (`profile-classic1x-us`, whose suffix is replaced per region). A character is a Forever character only if it is in its region's `BATTLENET_PROFILE_NAMESPACE` and:
- when `BATTLENET_REALMS` has entries for its region, it is on one of those realms (an explicit list of Forever realms; it overrides the next rule). Entries are `slug` (both regions) or `eu:slug` / `us:slug`;
- otherwise, it is not on a known pre-Forever realm (Classic Era, Hardcore, Seasonal, Anniversary or progression; see `src/lib/wow-versions.ts`), and never on retail.

Linking also reads every namespace in `BATTLENET_SCAN_NAMESPACES`, so an account with no Forever characters is told what it does have, for example "2 Alliance characters in Classic Anniversary (...), but only WoW: Forever characters can be verified". Those characters are recorded (in `battlenet_links.scan`) but never offered for import. The server logs one count-only line per link or refresh (`[battlenet] link scan: profile-classic1x-us=404:0 profile-classicann-us=200:3 ... forever=0 excluded=3`). After launch, link a test account: if its Forever characters show up as "other realms", set `BATTLENET_REALMS` to the Forever realm slugs; if they don't show up at all, change `BATTLENET_PROFILE_NAMESPACE` (use `{region}` as a placeholder). No code change is needed.

To test before launch with characters from another game (for example Anniversary), set `BATTLENET_PROFILE_NAMESPACE=profile-classicann-{region}` and `BATTLENET_REALMS=<realm slugs>` on a preview deployment. Those characters would import as verified, so don't do this in production.

**Mock mode.** `BATTLENET_MOCK=1` replaces Blizzard with fixture characters (Aldric, Brenna and Corwin for the Alliance, a Horde warrior and a Death Knight that are filtered out) in the US Forever namespace, one EU character (Isolde, a Dwarf Paladin on Hollowmere) offered only to Europe guilds, plus an Anniversary character (Elowen, Dreamscythe) that is listed as found but excluded. An authorization seed containing `eu-forbidden` gets 403 from every EU namespace, to exercise a one-region account. Linking skips the Battle.net page. Playwright always runs in mock mode, and the Vitest suites inject a fake `fetch`; no test calls Blizzard. The app refuses mock mode when `VERCEL_ENV=production`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Local Docker: `postgres://osm:osm@localhost:5434/osm`. Neon: the pooled connection string. |
| `AUTH_SECRET` | yes | Random secret for Auth.js (`openssl rand -base64 32`). |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | yes | Discord OAuth application credentials. |
| `AUTH_TRUST_HOST` | on Vercel | `true` so Auth.js trusts the forwarded host. |
| `ROOT_DOMAIN` | in production | `guildbook.io`. Guilds are served at `{slug}.ROOT_DOMAIN`. Empty means `localhost`. |
| `ALT_DOMAINS` | no | Comma-separated domains that 308-redirect to `ROOT_DOMAIN`, keeping subdomain and path. Empty for now; `guildbook.gg` if it is added later. |
| `AUTH_COOKIE_DOMAIN` | in production | `guildbook.io`: the session cookie is set on `.guildbook.io`, so one sign-in covers every guild subdomain. Leave empty locally. |
| `DEFAULT_GUILD_SLUG` | no | Guild served on hosts that are neither the apex nor a guild (`*.vercel.app` previews, IP addresses). Empty serves the apex there. Bare `localhost` is always the apex. Leave empty in production. |
| `NEXT_PUBLIC_MULTI_GUILD` | no | Legacy dev fallback: `true` serves guilds at `/<slug>/...` on one host. |
| `GUILD_CREATE_LIMIT` / `GUILD_CREATE_DAILY_LIMIT` | no | Guilds one account may own at once (default 3; deleting a guild frees a slot) and found per rolling day (default 2). |
| `GUILD_CREATE_LIMIT_OVERRIDES` | no | Raise (or lower) one account's `GUILD_CREATE_LIMIT`: comma-separated `discordId:limit` pairs. |
| `PLATFORM_ADMIN_DISCORD_IDS` | no | Comma-separated Discord IDs of platform admins, who have no guild creation limits. |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` | no | Lets custom domains be attached and checked through the Vercel Domains API. Without them, domains are verified by TXT record only and attached in Vercel by hand. |
| `BATTLENET_CLIENT_ID` / `BATTLENET_CLIENT_SECRET` | for Battle.net | develop.battle.net client credentials. Without them (and without mock mode) the Battle.net options are hidden. |
| `BATTLENET_REGION` | no | Default region, `us` (default) or `eu`: item lookups and the region recorded on a link. |
| `BATTLENET_REGIONS` | no | Regions read when linking, default `us,eu`. |
| `BATTLENET_TOKEN_KEY` | for Battle.net | 32 bytes, base64. Encrypts stored access tokens. |
| `BATTLENET_PROFILE_NAMESPACE` | no | Profile API namespace template WoW: Forever characters are read from, default `profile-classic1x-{region}`. A base or a `-us` name also works. See above. |
| `BATTLENET_REALMS` | no | Comma-separated WoW: Forever realm slugs, optionally `eu:` or `us:` prefixed. When a region has any, only characters on those realms can be verified there. See above. |
| `BATTLENET_SCAN_NAMESPACES` | no | Comma-separated namespaces read at link time to explain an empty result. Default `profile-classic1x-{region},profile-classicann-{region},profile-classic-{region},profile-{region}`. |
| `BATTLENET_STATIC_NAMESPACE` | no | Game Data namespace for loot item names and icons, default `static-classic1x-{region}`. See Loot ledger. |
| `BATTLENET_DYNAMIC_NAMESPACE` | no | Game Data namespace for realm types, used by guild verification. Defaults to the profile namespace's `dynamic-` twin. |
| `BATTLENET_REALM_RULESETS` | no | Realm slug to ruleset overrides (`realm-a:pvp,eu:realm-b:normal`), checked before Blizzard's realm type. A region prefix limits an entry to that region. |
| `BATTLENET_GUILD_REALM` / `BATTLENET_GUILD_SLUG` | no | In-game guild for one-request roster syncs. |
| `BATTLENET_GUILD_REGION` | no | Region of that in-game guild, default `us`. |
| `BATTLENET_REDIRECT_URI` | no | Overrides `<origin>/api/battlenet/callback`. |
| `BATTLENET_MOCK` | dev/test only | `1` serves fixture characters instead of calling Blizzard. |
| `CRON_SECRET` | on Vercel | Bearer secret for `/api/cron/daily` and `/api/cron/battlenet-sync`. |
| `APPLICATION_RETENTION_DAYS` | no | Days before withdrawn and declined applications are deleted (default 180). Shown in the privacy policy. |
| `GITHUB_TOKEN` | no | Raises the GitHub API rate limit for the Vigil download page's release lookup. Not needed for public repositories. |
| `AUTH_TEST_MODE` | dev/test only | `1` enables the test-login provider used by Playwright. |
| `E2E_DATABASE_URL` | no | Database for Playwright runs (defaults to `DATABASE_URL`). **It is wiped and reseeded.** |

### Migrations

The schema lives in `src/db/schema.ts`. Migrations are SQL files in `drizzle/`, generated and applied with drizzle-kit. Don't use `drizzle-kit push`.

1. Edit `src/db/schema.ts`.
2. `pnpm db:generate --name <short_description>` writes `drizzle/NNNN_<name>.sql` and updates `drizzle/meta/`.
3. Review the SQL. For things Drizzle can't express (triggers, functions), create an empty migration with `pnpm drizzle-kit generate --custom --name <name>` and write the SQL by hand, separating statements with `--> statement-breakpoint`.
4. `pnpm db:migrate` applies pending migrations to `DATABASE_URL`.
5. Commit the schema change, the SQL file and `drizzle/meta` together.

Production: run `DATABASE_URL=<neon-url> pnpm db:migrate` before (or as part of) promoting a deployment. Use a direct (non-pooled) Neon URL for migrations if the pooler rejects DDL.

### Testing

```bash
pnpm test        # Vitest: unit tests + integration tests on in-memory Postgres (PGlite), real migrations applied
pnpm test:e2e    # Playwright on mobile + desktop viewports; starts `pnpm dev` with AUTH_TEST_MODE=1 and reseeds
pnpm typecheck   # on a fresh checkout, run `pnpm exec next typegen` first to generate route types
pnpm lint
```

The integration tests need no database server. Each file boots PGlite and runs every migration, so the triggers and composite foreign keys are tested too.

GitHub Actions runs typecheck, lint, Vitest and a production build on every push to `main` and every pull request ([`ci.yml`](.github/workflows/ci.yml)). The Playwright suite runs separately against a throwaway Postgres ([`e2e.yml`](.github/workflows/e2e.yml)).

### Hosting

**Routing.** `src/proxy.ts` reads the `Host` header (logic in `src/lib/hosts.ts`, unit-tested):

| Host | Result |
|---|---|
| `guildbook.io` | Platform pages from `src/app/platform/` (landing, `/login`, `/create`, `/guilds`, `/vigil`) |
| `www.guildbook.io`, and any `ALT_DOMAINS` host with its subdomains | 308 to the same name and path on `guildbook.io` |
| `{slug}.guildbook.io` | Rewritten onto `src/app/[guild]/`. Links carry no slug (`guildHref` only prefixes in the legacy path mode) |
| Reserved subdomains (`www`, `app`, `api`, `auth`, `admin`, `mail`, `static`, `assets`, `docs`, `status`, `blog` and more) | Redirect to the apex. They can never be guild slugs |
| Any other host | Looked up in `guild_domains` (verified only, cached per instance for 60 s). Unknown hosts get the default guild or the apex |
| `localhost`, `www.localhost`, `{slug}.localhost` (dev) | The apex, a redirect to the apex, and guilds, mirroring the rows above |

**Sign-in.** All OAuth happens on the apex. A guild's `/login` redirects to `guildbook.io/login?callbackUrl=<guild URL>`. `callbackUrl` (and the Auth.js `redirect` callback, and the Battle.net `returnTo`) must be a same-origin path, the apex, a non-reserved guild subdomain over https, or a verified custom domain; anything else falls back to the apex, so there are no open redirects. The session cookie is set on `.guildbook.io` (`AUTH_COOKIE_DOMAIN`), so subdomains share it. Custom domains can't share that cookie, so the apex hands the session over once: `/api/handoff/start` mints a 60-second HMAC-signed token bound to the target host and stored (hashed) for one use; the custom domain's `/api/handoff/complete` redeems it and sets its own host-only session cookie. Locally, browsers refuse `Domain=localhost` cookies, so `*.localhost` uses the same handoff.

**Creating a guild.** Signed-in users create guilds at `guildbook.io/create`: name, subdomain (live availability check), faction, ruleset, timezone, motto and directory opt-in. The creator becomes Guild Master (Admin tier) and lands on `{slug}.guildbook.io/admin`. New guilds use the neutral `standard` preset (Guild Master, Officer, Raider, Member, Trial, Applicant; a plain charter, loot policy and "Our story" page; a monogram shield). The Order's Catholic ranks, prayer, lore, crest and copy belong to the `order` preset only. Creation is limited per account (`GUILD_CREATE_LIMIT`, `GUILD_CREATE_DAILY_LIMIT`, with `GUILD_CREATE_LIMIT_OVERRIDES` and `PLATFORM_ADMIN_DISCORD_IDS` for exceptions) and rate-limited. When the subdomain matching a name is taken, the form suggests ones that name what sets the new guild apart, like `oathbound-pvp`, `oathbound-horde` or `oathbound-eu`, before falling back to `oathbound-2`.

**Custom domains.** Guild admins add a domain under Admin, Guild. The page shows the records to create: an A record to `76.76.21.21` (apex domains) or a CNAME to `cname.vercel-dns.com` (subdomains), plus a TXT record `_guildbook.<domain>` with a per-domain token. **Check verification** requires the TXT token (so nobody can claim a domain another guild set up) and, when `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` are set, that Vercel has the domain attached, verified and correctly configured. Only verified domains are routed, and a guild's first verified domain becomes its canonical URL.

**Vigil companion.** The desktop app only talks to the apex (`https://guildbook.io`, built in). Pairing codes are global, so the apex knows which guild a code belongs to and answers with that guild's canonical site (its verified custom domain, else `https://{slug}.guildbook.io`), which the app uses for links. The API routes under `/api/vigil/companion/` answer on every host, so older pairings keep working. Downloads live at `guildbook.io/vigil`; the app itself is in [Guildbook/vigil](https://github.com/Guildbook/vigil).

#### Deploying on Vercel

1. **Nameservers.** In the Vercel dashboard, add `guildbook.io` to the team and point the registrar's nameservers at Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`). Wildcard domains need Vercel DNS.
2. **Domains on the project.** Add `guildbook.io` and `*.guildbook.io` to the project. Add `www.guildbook.io` too (the app redirects it).
3. **Adding guildbook.gg later.** Add `guildbook.gg` and `*.guildbook.gg` to the project and set `ALT_DOMAINS=guildbook.gg`; the app 308-redirects them to `.io`, keeping the subdomain and path. To make `.gg` primary instead, set `ROOT_DOMAIN=guildbook.gg`, `AUTH_COOKIE_DOMAIN=guildbook.gg`, `ALT_DOMAINS=guildbook.io` and add the `.gg` OAuth redirect URIs. No code changes either way.
4. **Environment variables** (Production): `ROOT_DOMAIN=guildbook.io`, `AUTH_COOKIE_DOMAIN=guildbook.io`, `ALT_DOMAINS` empty, `AUTH_TRUST_HOST=true`, `BATTLENET_REDIRECT_URI=https://guildbook.io/api/battlenet/callback`, and leave `DEFAULT_GUILD_SLUG` empty. Optional: `VERCEL_TOKEN` (a token scoped to the team), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, and the creation limits. Previews (`*.vercel.app`) serve the apex, or `DEFAULT_GUILD_SLUG` if you set one for the Preview environment.
5. **OAuth apps.** The Discord app already has `https://guildbook.io/api/auth/callback/discord`. Add `https://guildbook.io/api/battlenet/callback` to the Battle.net client.
6. **Database.** `DATABASE_URL=<neon-direct-url> pnpm db:migrate`, then `DATABASE_URL=<neon-direct-url> pnpm db:bootstrap`, which creates the Order of Saint Michael (ranks, charter, lore, schedule, raids, addons) with no members or demo data, and does nothing if it already exists. Deploy, and the Order is at `osm.guildbook.io`. Never run `pnpm db:seed` against production.
7. **Guild leader.** After signing in on `guildbook.io` with Discord once, run `DATABASE_URL=<neon-direct-url> pnpm guild:grant-owner --guild osm --discord <Discord user ID or username>`. It makes that user an active member at the top admin rank (Grand Master) and records it in the audit log.

### Architecture

**Guild scoping.** Every table except `users` and the Auth.js tables has a `guild_id`, and every service query filters by it. Child tables reference their parent through a composite `(guild_id, id)` foreign key, so Postgres rejects a row that points at another guild's data even if application code gets it wrong. All guild pages live under `src/app/[guild]/`, and `src/proxy.ts` rewrites each guild's host onto them (`osm.guildbook.io/roster` renders `/osm/roster`). Build links with `guildHref()` so the legacy path-prefixed mode keeps working.

**Permissions.** Ranks are rows in `ranks` (name, sort order, description, permission tier), so officers can rename and reorder them freely. Renaming or reordering never changes permissions; only the tier does. `src/lib/authz/policy.ts` holds the one `POLICY` map from action to minimum tier, plus `can`/`assertCan`. Every service function calls `assertCan(actor, action)` first. The actor's tier is read from the database on each request, never from the session. The UI uses `can()` only to decide what to render. Additional rules:
- nobody grants a tier above their own;
- officers can't change peers or superiors;
- the last active Admin can't be demoted or removed;
- at most 10 ranks may be marked in-game (the WoW limit).

**Audit log.** Officer actions write to `audit_log` in the same transaction as the change. A trigger rejects `UPDATE` and `DELETE` on that table.

**Loot ledger.** `loot_entries` is append-only too, through the generic `append_only_guard()` trigger (`drizzle/0013_loot_ledger_guard.sql`). A mistake is corrected by a reversal row (with a reason), never an edit. The guard allows three exceptions: reference columns may become NULL when what they point at is deleted; with `guildbook.audit_redact` on, account deletion may replace the recipient name and note with "Deleted user"; and with `guildbook.audit_purge_guild` set, a guild deletion (and the demo reseed) may delete that guild's rows.
- Members see the ledger at `/members/loot`, per raid night and on each character page. A guild can make it public in Guild Settings (off by default). Officers record awards and reversals at `/admin/loot`.
- **Imports** (`/admin/loot/import`): Gargul JSON, TMB CSV and custom-format exports, and RCLootCouncil CSV and JSON. Parsers live in `src/lib/loot/parsers/` behind one registry with auto-detection. An import is parsed into a draft for review: officers match each name to a character (remembered for next time), keep a pug's name, or leave it out. Committing skips awards already recorded, keyed on the tool's own award ID (Gargul's checksum is shared by its JSON and TMB exports), or on a hash of item, player and minute when there is none. Drafts are deleted after a week.
- **Item data** (`wow_version_items`, shared across guilds, one row per game version and item ID, since versions can rework an item under the same ID): names and qualities from imports and officer entry come first. Blizzard's Game Data API only fills gaps (names missing from an export, icons), in the static namespace of the item's game version (`BATTLENET_STATIC_NAMESPACE` for WoW: Forever), and only with real Battle.net credentials. The old `wow_items` table stays until a cleanup migration drops it; the daily cron purges its expired Blizzard data meanwhile. Per Blizzard's API terms, the daily cron refreshes Blizzard data after 25 days and deletes anything it couldn't refresh within 30, and pages that show it credit Blizzard. Item icons are hotlinked from Blizzard's render CDN, never stored. Items link to Wowhead; there is no Wowhead tooltip script.
- No DKP, EPGP or GDKP: entries have no cost.

**Layout.**

```
src/app/[guild]/        guild pages (public, /members, /admin), served on each guild's host
src/app/platform/       Guildbook apex pages (landing, sign-in, create, directory, Vigil download)
src/server/services/    business logic, one function per use case, takes (db, actor, rawInput)
src/server/actions/     thin "use server" wrappers: FormData → service → refresh
src/lib/validation.ts   Zod schemas for every form and service input
src/lib/authz/          tiers + policy (pure, unit-tested)
src/db/                 schema, client, seed data
drizzle/                SQL migrations
tests/                  integration tests (PGlite); e2e/ Playwright
```

### Vigil companion

The Vigil desktop companion (Electron) lives in its own repository, [Guildbook/vigil](https://github.com/Guildbook/vigil), with its build, release and signing instructions. It tails `WoWCombatLog*.txt` on a second monitor, shows the current fight live and uploads each finished fight here through `/api/vigil/companion/`. It vendors this repository's combat log parser and Vigil analysis (`src/lib/combatlog/`, `src/lib/vigil/`, `src/lib/game.ts`) in its `shared/` folder, so keep `src/lib/vigil/report.ts`, the upload contract, compatible with the app or change both together.

The download page at `guildbook.io/vigil` (`src/app/platform/vigil/page.tsx`) lists the latest published release of Guildbook/vigil (tags `v<version>`) from GitHub's public API without a token, cached for an hour; set `GITHUB_TOKEN` on Vercel only if you hit the rate limit. It reads the `vigil-signing` marker the release workflow writes into the notes to decide whether to explain Gatekeeper and SmartScreen.

## Roadmap

- Raid calendar with signups and composition targets, and attendance with 4 and 8 week percentages.
- Guild bank tracking alongside the loot ledger.
- Discord bot: post raids, reaction signups, role sync.
- Warcraft Logs import.

## Contributing

Issues and pull requests are welcome at [Guildbook/guildbook](https://github.com/Guildbook/guildbook). Before opening a pull request, make sure `pnpm typecheck`, `pnpm lint` and `pnpm test` pass (CI checks these and the production build), and include a migration for any schema change. Keep changes scoped to one guild's data (see Guild scoping) and put permission checks in the service layer. Bugs and ideas for the desktop companion belong in [Guildbook/vigil](https://github.com/Guildbook/vigil).

## License

Guildbook is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source available to its users. The license does not cover Blizzard artwork (the icons in `public/icons/classes/` and `public/icons/factions/`, and the guild tabard emblems in `public/tabard/`, see their `NOTICE` files) or the bundled fonts (see `scripts/fonts/OFL.txt`).

World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. Guildbook is a non-commercial fan project, not affiliated with or endorsed by Blizzard. It uses no Blizzard logos. The class and faction icons in `public/icons/` and the guild tabard emblems in `public/tabard/` are Blizzard artwork (see the `NOTICE` files there), and loot item icons are shown from Blizzard's render CDN without being stored.
