CREATE TABLE "report_card_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_player_id" uuid NOT NULL,
	"token" text NOT NULL,
	"rating_leak" integer NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "report_card_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "report_card_link" ADD CONSTRAINT "report_card_link_created_by_player_id_player_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_card_link_creator_idx" ON "report_card_link" USING btree ("created_by_player_id");
