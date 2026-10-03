import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import { z } from "zod";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { hostConfigFromEnv, validateRedirectTarget } from "@/lib/hosts";
import { isProductionRuntime } from "@/lib/runtime-env";
import { stripOAuthTokens } from "@/server/auth-adapter";

const hostConfig = hostConfigFromEnv();

declare module "next-auth" {
  interface Session {
    user: { id: string; discordId?: string; name?: string | null; image?: string | null; email?: string | null };
  }
  interface User {
    discordId?: string | null;
    discordUsername?: string | null;
  }
}

export const testModeEnabled = process.env.AUTH_TEST_MODE === "1";
if (testModeEnabled && isProductionRuntime()) {
  throw new Error("AUTH_TEST_MODE must never be enabled in production.");
}

const testLoginInput = z.object({
  discordId: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
});

/** Playwright cannot complete Discord OAuth, so e2e runs sign in through this provider. */
const testProvider = Credentials({
  id: "test-login",
  name: "Test login",
  credentials: { discordId: {}, name: {} },
  async authorize(raw) {
    const parsed = testLoginInput.safeParse(raw);
    if (!parsed.success) return null;
    const { discordId, name } = parsed.data;
    const [user] = await db
      .insert(users)
      .values({ discordId, name, discordUsername: name })
      .onConflictDoUpdate({ target: users.discordId, set: { name } })
      .returning();
    return user ?? null;
  },
});

const config: NextAuthConfig = {
  adapter: stripOAuthTokens(
    DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
  ),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // AUTH_COOKIE_DOMAIN=guildbook.io shares the session with every guild subdomain. Unset (localhost, previews)
  // keeps the default host-only cookie. Custom domains get their own cookie through the handoff in server/handoff.ts.
  ...(hostConfig.cookieDomain ? { cookies: { sessionToken: { options: { domain: `.${hostConfig.cookieDomain}` } } } } : {}),
  providers: [
    Discord({
      profile(profile) {
        const image = profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
          : null;
        return {
          id: profile.id,
          name: profile.global_name ?? profile.username,
          email: profile.email,
          image,
          discordId: profile.id,
          discordUsername: profile.username,
        };
      },
    }),
    ...(testModeEnabled ? [testProvider] : []),
  ],
  callbacks: {
    /** After sign-in, allow only the apex, its guild subdomains and local dev hosts. Anything else lands home. */
    redirect({ url, baseUrl }) {
      return validateRedirectTarget(url, baseUrl, { config: hostConfig }) ?? baseUrl;
    },
    jwt({ token, user, account }) {
      if (user?.id) token.uid = user.id;
      const discordId = user?.discordId ?? (account?.provider === "discord" ? account.providerAccountId : null);
      if (discordId) token.did = discordId;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      if (typeof token.did === "string") session.user.discordId = token.did;
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "discord" || !user.id || !profile) return;
      await db
        .update(users)
        .set({
          discordId: account.providerAccountId,
          discordUsername: typeof profile.username === "string" ? profile.username : null,
          name: user.name,
          image: user.image,
        })
        .where(eq(users.id, user.id));
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
