CREATE TABLE `hero_matchups` (
	`hero_id` integer NOT NULL,
	`vs_hero_id` integer NOT NULL,
	`games` integer NOT NULL,
	`wins` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`hero_id`, `vs_hero_id`),
	FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vs_hero_id`) REFERENCES `heroes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hero_patch_stats` (
	`hero_id` integer NOT NULL,
	`patch` text NOT NULL,
	`bracket` text NOT NULL,
	`picks` integer NOT NULL,
	`wins` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`hero_id`, `patch`, `bracket`),
	FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `heroes` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`localized_name` text NOT NULL,
	`img_url` text NOT NULL,
	`primary_attr` text NOT NULL,
	`attack_type` text NOT NULL,
	`roles` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta_sync` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`rows_written` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
