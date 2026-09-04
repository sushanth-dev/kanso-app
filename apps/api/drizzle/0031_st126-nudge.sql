CREATE TABLE "nudge_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "nudge_unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nudge_send" ADD CONSTRAINT "nudge_send_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nudge_send_user_sent_idx" ON "nudge_send" USING btree ("user_id","sent_at");