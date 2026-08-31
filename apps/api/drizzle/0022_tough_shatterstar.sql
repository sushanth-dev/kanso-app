CREATE TABLE "advice_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" "weakness_kind" NOT NULL,
	"group_key" text NOT NULL,
	"summary" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advice_progress" ADD CONSTRAINT "advice_progress_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advice_progress_player_unique" ON "advice_progress" USING btree ("player_id","kind","group_key");