-- ST-040. Scope the online verification stream to blitz opening and endgame.
-- tactical_alertness becomes tournament-only; time_management is retired
-- because it was online-only and online now measures only opening and endgame.
UPDATE "focus_catalogue"
SET "measurable_streams" = ARRAY['tournament']::"stream"[]
WHERE "key" = 'tactical_alertness';

UPDATE "focus_catalogue"
SET "retired_at" = now()
WHERE "key" = 'time_management';
