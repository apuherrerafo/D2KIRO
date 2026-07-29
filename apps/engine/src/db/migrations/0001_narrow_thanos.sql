CREATE TABLE `hero_pool` (
	`hero_id` integer PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`personal_winrate` real,
	`personal_games` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON UPDATE no action ON DELETE no action
);
