CREATE TYPE "public"."action_item_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."resource_tier" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TABLE "action_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" "weakness_kind" NOT NULL,
	"group_key" text NOT NULL,
	"resource_index" smallint NOT NULL,
	"tier" "resource_tier" NOT NULL,
	"resource" text NOT NULL,
	"status" "action_item_status" DEFAULT 'pending' NOT NULL,
	"summary" text,
	"label" text NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "advice_progress_player_unique";--> statement-breakpoint
ALTER TABLE "puzzle_attempt" ADD COLUMN "review_level" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "puzzle_attempt" ADD COLUMN "next_review_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "puzzle_attempt" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_item_player_unique" ON "action_item" USING btree ("player_id","kind","group_key","resource_index");--> statement-breakpoint
CREATE INDEX "action_item_player_idx" ON "action_item" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "puzzle_attempt_review_idx" ON "puzzle_attempt" USING btree ("player_id","next_review_at");