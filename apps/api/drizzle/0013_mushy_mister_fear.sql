CREATE TABLE "evaluation_cache" (
	"fen" text NOT NULL,
	"engine_version" text NOT NULL,
	"depth" smallint NOT NULL,
	"eval_cp" integer,
	"eval_mate" smallint,
	"best_move_uci" text,
	"nodes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_cache_fen_engine_version_depth_pk" PRIMARY KEY("fen","engine_version","depth")
);
