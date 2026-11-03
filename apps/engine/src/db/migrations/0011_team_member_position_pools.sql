CREATE TABLE `team_member_position_pools` (
	`member_id` integer NOT NULL,
	`position` integer NOT NULL,
	`hero_pool` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `position`),
	FOREIGN KEY (`member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `team_member_position_pools` (`member_id`, `position`, `hero_pool`, `version`, `updated_at`)
SELECT `id`, `position`, `hero_pool`, 1, `updated_at` FROM `team_members`
WHERE `position` BETWEEN 1 AND 5 AND json_valid(`hero_pool`) AND json_type(`hero_pool`) = 'array' AND json_array_length(`hero_pool`) > 0;
