CREATE TABLE "practice_attempt" (
	"player_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"ply" smallint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"solved" boolean DEFAULT false NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_attempt_player_id_game_id_ply_pk" PRIMARY KEY("player_id","game_id","ply")
);
--> statement-breakpoint
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;