CREATE TABLE `session` (
	`id` integer PRIMARY KEY,
	`tabs_json` text NOT NULL,
	`active_index` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`x` integer,
	`y` integer,
	`orientation` text,
	`saved_at` integer NOT NULL
);
