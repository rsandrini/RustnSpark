-- The ship's type now names its main point from a 7-axis profile (ship_profile.*): the three share
-- thresholds of the old class model are gone, and so are any values an admin stored for them.
-- The new ship_profile.* keys are seeded from the registry defaults at boot.
DELETE FROM "GameConfig"
WHERE "key" IN (
  'ship_class.cargo_share',
  'ship_class.combat_share',
  'ship_class.pressurized_share'
);
