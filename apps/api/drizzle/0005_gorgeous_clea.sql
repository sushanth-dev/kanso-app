ALTER TABLE "player" ADD COLUMN "chesscom_rating" smallint;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "lichess_rating" smallint;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "rating_fetched_at" timestamp with time zone;