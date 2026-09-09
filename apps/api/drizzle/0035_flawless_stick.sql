CREATE TYPE "public"."retirement_state" AS ENUM('active', 'candidate', 'retired', 'came_back');--> statement-breakpoint
CREATE TABLE "pattern_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" "weakness_kind" NOT NULL,
	"group_key" text NOT NULL,
	"stream" "stream" NOT NULL,
	"label" text NOT NULL,
	"state" "retirement_state" DEFAULT 'candidate' NOT NULL,
	"mastered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"came_back_at" timestamp with time zone,
	"last_alert_game_id" uuid
);
--> statement-breakpoint
ALTER TABLE "pattern_state" ADD CONSTRAINT "pattern_state_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_state" ADD CONSTRAINT "pattern_state_last_alert_game_id_game_id_fk" FOREIGN KEY ("last_alert_game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pattern_state_group_unique" ON "pattern_state" USING btree ("player_id","kind","group_key","stream");--> statement-breakpoint
CREATE INDEX "pattern_state_player_idx" ON "pattern_state" USING btree ("player_id","state");