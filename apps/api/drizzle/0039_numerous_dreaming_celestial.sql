CREATE TYPE "public"."confidence" AS ENUM('sure', 'not_sure', 'guessed');--> statement-breakpoint
ALTER TABLE "puzzle_attempt" ADD COLUMN "confidence" "confidence";