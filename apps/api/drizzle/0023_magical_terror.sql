CREATE TABLE "puzzle" (
	"lichess_id" text PRIMARY KEY NOT NULL,
	"fen" text NOT NULL,
	"moves" text NOT NULL,
	"rating" integer NOT NULL,
	"themes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "puzzle_attempt" (
	"player_id" uuid NOT NULL,
	"puzzle_id" text NOT NULL,
	"kind" "weakness_kind" NOT NULL,
	"group_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"solved" boolean DEFAULT false NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_attempt_player_id_puzzle_id_pk" PRIMARY KEY("player_id","puzzle_id")
);
--> statement-breakpoint
DROP TABLE "practice_attempt" CASCADE;--> statement-breakpoint
ALTER TABLE "puzzle_attempt" ADD CONSTRAINT "puzzle_attempt_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_attempt" ADD CONSTRAINT "puzzle_attempt_puzzle_id_puzzle_lichess_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzle"("lichess_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "puzzle_themes_idx" ON "puzzle" USING gin ("themes");--> statement-breakpoint
CREATE INDEX "puzzle_rating_idx" ON "puzzle" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "puzzle_attempt_group_idx" ON "puzzle_attempt" USING btree ("player_id","kind","group_key");