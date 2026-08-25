ALTER TABLE `team_groups` ADD COLUMN `account_id` integer REFERENCES `accounts`(`steam_account_id`);
--> statement-breakpoint
UPDATE `team_groups`
SET `account_id` = (SELECT `steam_account_id` FROM `accounts` LIMIT 1)
WHERE (SELECT COUNT(*) FROM `accounts`) = 1;
