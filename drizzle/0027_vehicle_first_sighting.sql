ALTER TABLE `vehicle` ADD `first_sighting` text DEFAULT 'arrival' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_departure` ADD `first_sighting` text DEFAULT 'arrival' NOT NULL;--> statement-breakpoint
-- A listing first seen no later than its yard's first published crawl, or at
-- a yard with no baseline yet, came with that yard's backfill.
UPDATE `vehicle` SET `first_sighting` = 'yard_backfill'
WHERE NOT EXISTS (
  SELECT 1 FROM `yard_arrival_baseline` AS `baseline`
  WHERE `baseline`.`source` = `vehicle`.`source`
    AND `baseline`.`location_code` = `vehicle`.`location_code`
    AND `vehicle`.`first_seen_at` > `baseline`.`established_at`
);--> statement-breakpoint
UPDATE `vehicle_departure` SET `first_sighting` = 'yard_backfill'
WHERE NOT EXISTS (
  SELECT 1 FROM `yard_arrival_baseline` AS `baseline`
  WHERE `baseline`.`source` = `vehicle_departure`.`source`
    AND `baseline`.`location_code` = `vehicle_departure`.`location_code`
    AND `vehicle_departure`.`first_seen_at` > `baseline`.`established_at`
);
