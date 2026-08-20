CREATE TYPE "public"."time_trouble_reason" AS ENUM('no_clock_data', 'not_enough_evidence');--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "time_trouble_reason" time_trouble_reason;