CREATE TABLE `queue_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`position` integer NOT NULL,
	`progress_pct` integer NOT NULL,
	`progress_message` text NOT NULL,
	`checkpoint` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL
);
