CREATE TABLE `hero_pool_new` (
	`account_id` integer NOT NULL,
	`hero_id` integer NOT NULL,
	`source` text NOT NULL,
	`personal_winrate` real,
	`personal_games` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `hero_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`steam_account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `hero_pool_new` (`account_id`, `hero_id`, `source`, `personal_winrate`, `personal_games`, `updated_at`)
SELECT (SELECT `steam_account_id` FROM `accounts` LIMIT 1),
       `hero_id`, `source`, `personal_winrate`, `personal_games`, `updated_at`
FROM `hero_pool`
WHERE (SELECT COUNT(*) FROM `accounts`) = 1;
--> statement-breakpoint
DROP TABLE `hero_pool`;
--> statement-breakpoint
ALTER TABLE `hero_pool_new` RENAME TO `hero_pool`;
