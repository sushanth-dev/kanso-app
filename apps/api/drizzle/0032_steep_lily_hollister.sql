CREATE TABLE "assignment_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_player_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"instruction" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "assignment_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "assignment_link" ADD CONSTRAINT "assignment_link_created_by_player_id_player_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_link" ADD CONSTRAINT "assignment_link_catalogue_id_focus_catalogue_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."focus_catalogue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_link_creator_idx" ON "assignment_link" USING btree ("created_by_player_id");