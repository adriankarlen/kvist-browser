CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
