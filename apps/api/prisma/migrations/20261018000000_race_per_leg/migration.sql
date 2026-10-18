-- Race: one rule for every ship, settled leg by leg. A rival's hidden "form on the day" is gone (its
-- speed is what the board shows); rivals may run pushed engines for the whole race instead, set by
-- race.rival_push_chance (added by the seed's fill-what-is-missing step).
DELETE FROM "GameConfig" WHERE "key" = 'race.form_spread';
