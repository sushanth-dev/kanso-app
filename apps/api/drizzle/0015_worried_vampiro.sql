-- ST-072. Collapse every account to one player (1:1 with `user`), enforce it
-- with a unique owner, and backfill a player for every user without one.

-- 1. Re-point every row that referenced a duplicate player to that user's
-- earliest player, dropping games that would collide on (pgn_hash) or
-- (source, external_id) when the players collapse, then delete the duplicates.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT owner_user_id, (array_agg(id ORDER BY created_at, id))[1] AS kept_id
    FROM player
    GROUP BY owner_user_id
    HAVING count(*) > 1
  LOOP
    -- Drop a duplicate player's games that a kept-player game already covers,
    -- so re-pointing cannot violate the game unique indexes. The kept copy wins.
    -- ponytail: dedupe is against the kept player only; two duplicate players
    -- sharing a PGN hash with each other but not the kept player needs 3+
    -- players on one account, which the pre-launch data does not contain.
    DELETE FROM game g
    WHERE g.player_id IN (
        SELECT id FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id
      )
      AND (
        EXISTS (SELECT 1 FROM game k WHERE k.player_id = r.kept_id AND k.pgn_hash = g.pgn_hash)
        OR (
          g.external_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM game k
            WHERE k.player_id = r.kept_id AND k.source = g.source AND k.external_id = g.external_id
          )
        )
      );

    UPDATE import_job SET player_id = r.kept_id
      WHERE player_id IN (SELECT id FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id);
    UPDATE tournament SET player_id = r.kept_id
      WHERE player_id IN (SELECT id FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id);
    UPDATE game SET player_id = r.kept_id
      WHERE player_id IN (SELECT id FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id);
    UPDATE report SET player_id = r.kept_id
      WHERE player_id IN (SELECT id FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id);
    UPDATE player_focus SET player_id = r.kept_id
      WHERE player_id IN (SELECT id FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id);

    DELETE FROM player WHERE owner_user_id = r.owner_user_id AND id <> r.kept_id;
  END LOOP;
END $$;
--> statement-breakpoint
DROP INDEX "player_owner_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "player_owner_unique" ON "player" USING btree ("owner_user_id");--> statement-breakpoint
INSERT INTO "player" ("owner_user_id", "display_name", "birth_year")
SELECT u.id, u.name, substring(u.date_of_birth from 1 for 4)::smallint
FROM "user" u
WHERE NOT EXISTS (SELECT 1 FROM player p WHERE p.owner_user_id = u.id);
