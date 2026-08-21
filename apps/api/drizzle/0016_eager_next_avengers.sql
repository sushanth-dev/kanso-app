-- ST-074. Beginner/intermediate/pro replace free/paid, and the billing
-- periods retire into the three plans, so `plan` becomes `tier` here too.
-- Every existing payment purchased the single old paid plan, now called pro.
ALTER TABLE "processed_payment" RENAME COLUMN "plan" TO "tier";--> statement-breakpoint
ALTER TABLE "processed_payment" ALTER COLUMN "tier" SET DATA TYPE text;--> statement-breakpoint
UPDATE "processed_payment" SET "tier" = 'pro' WHERE "tier" IN ('monthly', 'season', 'yearly');--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "tier" SET DATA TYPE text;--> statement-breakpoint
-- Free maps to beginner; paid maps to pro, the only new tier that does not
-- silently cap an account that today has no cap.
UPDATE "subscription" SET "tier" = CASE "tier" WHEN 'free' THEN 'beginner' WHEN 'paid' THEN 'pro' END;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "tier" SET DEFAULT 'beginner'::text;--> statement-breakpoint
DROP TYPE "public"."tier";--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('beginner', 'intermediate', 'pro');--> statement-breakpoint
ALTER TABLE "processed_payment" ALTER COLUMN "tier" SET DATA TYPE "public"."tier" USING "tier"::"public"."tier";--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "tier" SET DEFAULT 'beginner'::"public"."tier";--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "tier" SET DATA TYPE "public"."tier" USING "tier"::"public"."tier";--> statement-breakpoint
DROP TYPE "public"."plan";