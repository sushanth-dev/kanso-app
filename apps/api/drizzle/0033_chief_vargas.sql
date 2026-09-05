CREATE TABLE "game_share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_player_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "game_share_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "game_share_link" ADD CONSTRAINT "game_share_link_created_by_player_id_player_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_share_link" ADD CONSTRAINT "game_share_link_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_share_link_creator_idx" ON "game_share_link" USING btree ("created_by_player_id");--> statement-breakpoint
CREATE INDEX "game_share_link_game_idx" ON "game_share_link" USING btree ("game_id");