CREATE TABLE `meta_sync_run` (
	`sync_id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	`patch_label` text,
	`patch_verified` integer DEFAULT 0 NOT NULL,
	`patch_basis` text,
	`quality_report` text,
	FOREIGN KEY (`sync_id`) REFERENCES `meta_sync`(`id`) ON UPDATE no action ON DELETE no action
);
