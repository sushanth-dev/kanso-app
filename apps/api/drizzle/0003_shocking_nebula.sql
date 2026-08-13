CREATE TABLE "tournament" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"site" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "tournament_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_player_key_idx" ON "tournament" USING btree ("player_id","key");--> statement-breakpoint
CREATE INDEX "tournament_player_idx" ON "tournament" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE set null ON UPDATE no action;