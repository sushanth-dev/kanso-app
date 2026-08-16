-- ST-032. Correct the converting won positions measure description, which
-- ST-031 seeded with the rating leak's words rather than a conversion rate.
UPDATE "focus_catalogue"
SET "measure_description" = 'The share of won positions converted to wins.'
WHERE "key" = 'converting_won_positions';
