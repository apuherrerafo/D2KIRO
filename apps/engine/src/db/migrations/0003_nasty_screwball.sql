CREATE TABLE `draft_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`comment` text NOT NULL,
	`draft_state` text NOT NULL,
	`suggestions` text,
	`created_at` text NOT NULL
);
