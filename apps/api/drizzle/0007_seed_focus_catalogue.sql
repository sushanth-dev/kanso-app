-- ST-031. Seed the four F10 focuses as catalogue rows, idempotently on `key`.
-- This is the prod path: the Migrate Lambda applies it, so the deployed API has
-- the catalogue without a dev-only `npm run seed`.
INSERT INTO "focus_catalogue" ("key", "title", "description", "measure_description", "measurable_streams") VALUES
	('converting_won_positions', 'Converting won positions', 'Winning the games the position already says are won.', 'The rating leaked by evaluation swings that crossed a result boundary.', ARRAY['tournament','online']::"stream"[]),
	('time_management', 'Time management', 'Using the clock so the position decides the game, not the flag.', 'The move where time trouble begins.', ARRAY['online']::"stream"[]),
	('opening_repertoire_results', 'Opening repertoire results', 'Which openings in the repertoire score, and which leak rating.', 'Results by opening, grouped by ECO code.', ARRAY['tournament','online']::"stream"[]),
	('tactical_alertness', 'Tactical alertness', 'Spotting the tactical motifs a position offers.', 'The tactical motifs missed.', ARRAY['tournament','online']::"stream"[])
ON CONFLICT ("key") DO NOTHING;
