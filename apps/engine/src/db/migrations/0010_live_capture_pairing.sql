CREATE TABLE `live_capture_pairings` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL REFERENCES `accounts`(`steam_account_id`),
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_capture_pairings_account_idx` ON `live_capture_pairings` (`account_id`);
--> statement-breakpoint
CREATE TABLE `live_capture_credentials` (
	`capture_id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL REFERENCES `accounts`(`steam_account_id`),
	`token_hash` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_capture_credentials_account_idx` ON `live_capture_credentials` (`account_id`);
