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
--> statement-breakpoint
-- La migración corre al arrancar el proceso, antes de cualquier sync: toda fila `running` es de un proceso muerto.
UPDATE `meta_sync` SET `status` = 'failed', `finished_at` = COALESCE(`finished_at`, `started_at`), `error` = COALESCE(`error`, 'abandoned: cerrado por la migración 0012')
WHERE `status` = 'running';
--> statement-breakpoint
-- Garantía de datos: a lo sumo UN sync `running` a la vez, aunque dos procesos/handlers compitan.
CREATE UNIQUE INDEX `meta_sync_one_running` ON `meta_sync` (`status`) WHERE `status` = 'running';
