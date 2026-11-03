CREATE TABLE `live_gsi_links` (
	`live_id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL REFERENCES `accounts`(`steam_account_id`),
	`token_hash` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_gsi_links_account_idx` ON `live_gsi_links` (`account_id`);
