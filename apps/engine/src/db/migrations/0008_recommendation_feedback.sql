CREATE TABLE `recommendation_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`hero_id` integer NOT NULL,
	`target_position` integer,
	`rating` text NOT NULL,
	`reason` text,
	`comment` text,
	`state_identity` text,
	`ruleset_id` text,
	`ruleset_version` text,
	`account_id` integer REFERENCES `accounts`(`steam_account_id`),
	`created_at` text NOT NULL
);
