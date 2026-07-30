CREATE TABLE `team_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`party_size` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_group_id` integer NOT NULL,
	`slot` integer NOT NULL,
	`name` text NOT NULL,
	`hero_pool` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_group_id`) REFERENCES `team_groups`(`id`) ON UPDATE no action ON DELETE no action
);
