CREATE TABLE `instagram_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`ig_user_id` text NOT NULL,
	`username` text NOT NULL,
	`page_id` text NOT NULL,
	`page_name` text NOT NULL,
	`connected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instagram_accounts_ig_user_id_unique` ON `instagram_accounts` (`ig_user_id`);--> statement-breakpoint
CREATE TABLE `instagram_publish_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text NOT NULL,
	`instagram_media_id` text,
	`permalink` text,
	`caption` text,
	`error` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `short_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instagram_publish_jobs_candidate_id_unique` ON `instagram_publish_jobs` (`candidate_id`);
