ALTER TABLE `vehicle` ADD `observed_arrival_at` integer;
--> statement-breakpoint
CREATE TABLE `yard_arrival_baseline` (
  `source` text NOT NULL,
  `location_code` text NOT NULL,
  PRIMARY KEY(`source`, `location_code`)
);
--> statement-breakpoint
-- Existing inventory is a baseline, never a fresh observed arrival.
INSERT INTO `yard_arrival_baseline` (`source`, `location_code`)
SELECT DISTINCT `source`, `location_code` FROM `vehicle`;
