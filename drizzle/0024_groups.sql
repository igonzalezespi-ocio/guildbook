CREATE TYPE "public"."group_kind" AS ENUM('raid', 'dungeon', 'lfg');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('tank', 'healer', 'dps');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('open', 'closed', 'cancelled', 'finished');--> statement-breakpoint
CREATE TABLE "group_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"kind" "group_kind" NOT NULL,
	"instance_key" text NOT NULL,
	"instance_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"leader_user_id" text,
	"tanks" smallint NOT NULL,
	"healers" smallint NOT NULL,
	"dps" smallint NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "group_status" DEFAULT 'open' NOT NULL,
	"reminded_at" timestamp with time zone,
	"discord_channel_id" text,
	"discord_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_events_guild_id_id_key" UNIQUE("guild_id","id"),
	CONSTRAINT "group_events_slots" CHECK ("group_events"."tanks" >= 0 and "group_events"."healers" >= 0 and "group_events"."dps" >= 0 and "group_events"."tanks" + "group_events"."healers" + "group_events"."dps" between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "group_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "group_role" NOT NULL,
	"bench" boolean DEFAULT false NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_signups_event_user_key" UNIQUE("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_events" ADD CONSTRAINT "group_events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_events" ADD CONSTRAINT "group_events_leader_user_id_users_id_fk" FOREIGN KEY ("leader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_signups" ADD CONSTRAINT "group_signups_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_signups" ADD CONSTRAINT "group_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_signups" ADD CONSTRAINT "group_signups_event_fk" FOREIGN KEY ("guild_id","event_id") REFERENCES "public"."group_events"("guild_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_signups" ADD CONSTRAINT "group_signups_character_fk" FOREIGN KEY ("guild_id","character_id") REFERENCES "public"."characters"("guild_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_events_guild_starts_idx" ON "group_events" USING btree ("guild_id","starts_at");