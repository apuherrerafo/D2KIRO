CREATE TABLE IF NOT EXISTS `accounts` (
	`steam_account_id` integer PRIMARY KEY NOT NULL,
	`personal_baseline_winrate` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`steam_account_id`, `personal_baseline_winrate`, `created_at`)
SELECT CAST(s.`value` AS INTEGER),
       (SELECT CAST(b.`value` AS REAL) FROM `settings` b WHERE b.`key` = 'personal_baseline_winrate'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `settings` s
WHERE s.`key` = 'steam_account_id'
  AND s.`value` GLOB '[0-9]*'
  AND s.`value` NOT GLOB '*[^0-9]*'
  AND CAST(s.`value` AS INTEGER) BETWEEN 1 AND 4294967295;
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('steam_account_id', 'personal_baseline_winrate');
