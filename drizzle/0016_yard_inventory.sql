CREATE TABLE `yard_inventory` (
	`source` text NOT NULL,
	`location_code` text NOT NULL,
	`location_name` text NOT NULL,
	`location_city` text NOT NULL,
	`state_abbr` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`vehicle_count` integer NOT NULL,
	`inventory_url` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`source`, `location_code`)
);
--> statement-breakpoint
CREATE INDEX `vehicle_yard_live_idx` ON `vehicle` (`source`,`location_code`,`missing_since_at`);;--> statement-breakpoint
INSERT INTO `yard_inventory` (`source`, `location_code`, `location_name`, `location_city`, `state_abbr`, `lat`, `lng`, `vehicle_count`, `inventory_url`, `updated_at`)
SELECT `live`.`source`, `live`.`location_code`, `sample`.`location_name`, `sample`.`location_city`, `sample`.`state_abbr`, `sample`.`lat`, `sample`.`lng`, `live`.`vehicle_count`, `sample`.`details_url`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
	SELECT `source`, `location_code`, count(*) AS `vehicle_count`
	FROM `vehicle` INDEXED BY `vehicle_yard_live_idx`
	WHERE `missing_since_at` IS NULL
	GROUP BY `source`, `location_code`
) `live`
JOIN `vehicle` `sample` ON `sample`.rowid = (
	SELECT rowid FROM `vehicle` INDEXED BY `vehicle_yard_live_idx`
	WHERE `source` = `live`.`source` AND `location_code` = `live`.`location_code` AND `missing_since_at` IS NULL
	LIMIT 1
);
