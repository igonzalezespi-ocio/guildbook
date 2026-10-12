CREATE TABLE "addon_sync_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_id" text,
	"token_name" text NOT NULL,
	"addon_version" text,
	"received" integer NOT NULL,
	"updated" integer NOT NULL,
	"unchanged" integer NOT NULL,
	"skipped_old" integer NOT NULL,
	"unmatched" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addon_sync_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "addon_sync_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "character_addon_links" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"guild_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"addon_time" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_addon_links_guid_key" UNIQUE("guild_id","guid")
);
--> statement-breakpoint
ALTER TABLE "addon_sync_reports" ADD CONSTRAINT "addon_sync_reports_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_sync_reports" ADD CONSTRAINT "addon_sync_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_sync_tokens" ADD CONSTRAINT "addon_sync_tokens_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_sync_tokens" ADD CONSTRAINT "addon_sync_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_sync_tokens" ADD CONSTRAINT "addon_sync_tokens_membership_fk" FOREIGN KEY ("guild_id","membership_id") REFERENCES "public"."memberships"("guild_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_addon_links" ADD CONSTRAINT "character_addon_links_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_addon_links" ADD CONSTRAINT "character_addon_links_character_fk" FOREIGN KEY ("guild_id","character_id") REFERENCES "public"."characters"("guild_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addon_sync_reports_guild_idx" ON "addon_sync_reports" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "addon_sync_tokens_guild_idx" ON "addon_sync_tokens" USING btree ("guild_id");