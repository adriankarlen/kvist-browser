CREATE TABLE `history` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`origin` text,
	`visited_at` integer NOT NULL
);
