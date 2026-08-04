CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'queued', 'analyzing', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."color" AS ENUM('white', 'black');--> statement-breakpoint
CREATE TYPE "public"."focus_source" AS ENUM('recommended', 'coach', 'self');--> statement-breakpoint
CREATE TYPE "public"."focus_trend" AS ENUM('improving', 'flat', 'declining', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."game_result" AS ENUM('1-0', '0-1', '1/2-1/2', '*');--> statement-breakpoint
CREATE TYPE "public"."game_source" AS ENUM('chesscom', 'lichess', 'pgn_upload');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('backfill', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."judgement" AS ENUM('inaccuracy', 'mistake', 'blunder');--> statement-breakpoint
CREATE TYPE "public"."game_phase" AS ENUM('opening', 'middlegame', 'endgame');--> statement-breakpoint
CREATE TYPE "public"."stream" AS ENUM('tournament', 'online');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "public"."weakness_kind" AS ENUM('opening', 'motif', 'phase', 'time_trouble');--> statement-breakpoint
CREATE TABLE "focus_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"measure_description" text NOT NULL,
	"measurable_streams" "stream"[] NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "focus_catalogue_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "focus_measurement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_focus_id" uuid NOT NULL,
	"stream" "stream" NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_games" smallint NOT NULL,
	"baseline_value" real,
	"current_value" real,
	"unit" text NOT NULL,
	"trend" "focus_trend" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"import_job_id" uuid,
	"stream" "stream" NOT NULL,
	"source" "game_source" NOT NULL,
	"external_id" text,
	"pgn_hash" text NOT NULL,
	"pgn" text NOT NULL,
	"player_color" "color" NOT NULL,
	"result" "game_result" NOT NULL,
	"played_at" timestamp with time zone,
	"move_count" smallint,
	"event" text,
	"site" text,
	"round" smallint,
	"board" smallint,
	"white_name" text,
	"black_name" text,
	"white_elo" smallint,
	"black_elo" smallint,
	"eco" text,
	"opening" text,
	"time_control" text,
	"has_clock_data" boolean DEFAULT false NOT NULL,
	"analysis_status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"analyzed_at" timestamp with time zone,
	"analysis_error" text,
	"analysis_nodes" integer,
	"analysis_duration_ms" integer,
	"analysis_cost_micros" integer,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_user_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"relationship" text,
	"consent_granted_at" timestamp with time zone,
	"consent_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"source" "game_source" NOT NULL,
	"kind" "import_kind" NOT NULL,
	"username" text,
	"stream" "stream" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"games_found" integer DEFAULT 0 NOT NULL,
	"games_imported" integer DEFAULT 0 NOT NULL,
	"games_rejected" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"ply" smallint NOT NULL,
	"move_number" smallint NOT NULL,
	"moving_color" "color" NOT NULL,
	"phase" "game_phase",
	"fen" text NOT NULL,
	"move_san" text NOT NULL,
	"best_move_san" text NOT NULL,
	"eval_before_cp" integer,
	"eval_before_mate" smallint,
	"eval_after_cp" integer,
	"eval_after_mate" smallint,
	"judgement" "judgement" NOT NULL,
	"cp_loss" integer NOT NULL,
	"win_prob_drop" real NOT NULL,
	"motif" text,
	"crossed_result_boundary" boolean DEFAULT false NOT NULL,
	"half_points_lost" real DEFAULT 0 NOT NULL,
	"explanation" text,
	"explanation_generated_at" timestamp with time zone,
	"socratic_question" text,
	"socratic_question_generated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "move_ply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"ply" smallint NOT NULL,
	"san" text NOT NULL,
	"uci" text NOT NULL,
	"fen_before" text NOT NULL,
	"phase" "game_phase",
	"eval_cp" integer,
	"eval_mate" smallint,
	"best_move_san" text,
	"best_move_uci" text,
	"clock_ms" integer,
	"move_time_ms" integer
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"birth_year" smallint,
	"fide_id" text,
	"fide_rating" smallint,
	"uscf_id" text,
	"uscf_rating" smallint,
	"chesscom_username" text,
	"lichess_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_focus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"catalogue_id" uuid,
	"coach_instruction" text,
	"source" "focus_source" NOT NULL,
	"narrowed_from_id" uuid,
	"paired_focus_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proof_sheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_focus_id" uuid NOT NULL,
	"token" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "proof_sheet_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"stream" "stream" NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"games_covered" integer NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"time_trouble_from_move" smallint,
	"narrative" text,
	"narrative_generated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tier" "tier" DEFAULT 'free' NOT NULL,
	"current_period_end" timestamp with time zone,
	"provider" text,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "weakness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" "weakness_kind" NOT NULL,
	"label" text NOT NULL,
	"eco" text,
	"rating_leak" integer NOT NULL,
	"half_points_lost" real NOT NULL,
	"games_affected" integer NOT NULL,
	"occurrences" integer NOT NULL,
	"rank" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "focus_measurement" ADD CONSTRAINT "focus_measurement_player_focus_id_player_focus_id_fk" FOREIGN KEY ("player_focus_id") REFERENCES "public"."player_focus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_guardian_user_id_user_id_fk" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake" ADD CONSTRAINT "mistake_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_ply" ADD CONSTRAINT "move_ply_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_focus" ADD CONSTRAINT "player_focus_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_focus" ADD CONSTRAINT "player_focus_catalogue_id_focus_catalogue_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."focus_catalogue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_sheet" ADD CONSTRAINT "proof_sheet_player_focus_id_player_focus_id_fk" FOREIGN KEY ("player_focus_id") REFERENCES "public"."player_focus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weakness" ADD CONSTRAINT "weakness_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_measurement_unique" ON "focus_measurement" USING btree ("player_focus_id","stream","measured_at");--> statement-breakpoint
CREATE INDEX "focus_measurement_focus_idx" ON "focus_measurement" USING btree ("player_focus_id","stream");--> statement-breakpoint
CREATE UNIQUE INDEX "game_external_unique" ON "game" USING btree ("player_id","source","external_id") WHERE "game"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "game_pgn_unique" ON "game" USING btree ("player_id","pgn_hash");--> statement-breakpoint
CREATE INDEX "game_stream_idx" ON "game" USING btree ("player_id","stream","played_at");--> statement-breakpoint
CREATE INDEX "game_analysis_status_idx" ON "game" USING btree ("analysis_status");--> statement-breakpoint
CREATE INDEX "game_eco_idx" ON "game" USING btree ("player_id","stream","eco");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_link_unique" ON "guardian_link" USING btree ("guardian_user_id","player_id");--> statement-breakpoint
CREATE INDEX "guardian_link_player_idx" ON "guardian_link" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "import_job_player_idx" ON "import_job" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_unique" ON "mistake" USING btree ("game_id","ply");--> statement-breakpoint
CREATE INDEX "mistake_motif_idx" ON "mistake" USING btree ("motif");--> statement-breakpoint
CREATE INDEX "mistake_leak_idx" ON "mistake" USING btree ("game_id","crossed_result_boundary");--> statement-breakpoint
CREATE UNIQUE INDEX "move_ply_unique" ON "move_ply" USING btree ("game_id","ply");--> statement-breakpoint
CREATE INDEX "player_owner_idx" ON "player" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_focus_one_active" ON "player_focus" USING btree ("player_id") WHERE "player_focus"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "player_focus_player_idx" ON "player_focus" USING btree ("player_id","started_at");--> statement-breakpoint
CREATE INDEX "proof_sheet_focus_idx" ON "proof_sheet" USING btree ("player_focus_id");--> statement-breakpoint
CREATE INDEX "report_player_idx" ON "report" USING btree ("player_id","stream","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weakness_rank_unique" ON "weakness" USING btree ("report_id","rank");