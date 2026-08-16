CREATE TABLE "guardian_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"consent_granted_at" timestamp with time zone,
	"consent_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "guardian_link" CASCADE;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "date_of_birth" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "guardian_email" text;--> statement-breakpoint
ALTER TABLE "guardian_consent" ADD CONSTRAINT "guardian_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_consent_user_unique" ON "guardian_consent" USING btree ("user_id");