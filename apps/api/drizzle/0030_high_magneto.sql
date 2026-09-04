-- ST-124. The review solve timestamp the ten-a-day review cap counts.
--
-- Deliberately no `ALTER TABLE "puzzle" ADD COLUMN "opening"` here, although
-- the snapshot records it: 0029 already added that column by hand (ST-122's
-- seed) and left the meta chain without a 0029 snapshot, so this generate
-- re-emitted it. 0029 sits earlier in the journal, so every database that
-- reaches this file has the column; re-adding it would fail the Migrate
-- Lambda. This migration's snapshot heals the chain.
ALTER TABLE "puzzle_attempt" ADD COLUMN "review_solved_at" timestamp with time zone;
