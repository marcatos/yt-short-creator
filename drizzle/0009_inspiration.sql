CREATE TABLE `inspiration_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`idea_count` integer NOT NULL,
	`error_message` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inspiration_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_run_id` text NOT NULL,
	`external_key` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`audience_interest` text,
	`channel_alignment` text,
	`related_interest` text,
	`outline` text,
	`suggested_titles` text NOT NULL,
	`thumbnail_notes` text,
	`raw_snippet` text,
	`captured_at` integer NOT NULL,
	`active` integer NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `inspiration_sync_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inspiration_ideas_active_idx` ON `inspiration_ideas` (`active`);--> statement-breakpoint
CREATE TABLE `candidate_inspiration_links` (
	`candidate_id` text NOT NULL,
	`idea_id` text NOT NULL,
	`alignment_score` real NOT NULL,
	PRIMARY KEY(`candidate_id`, `idea_id`),
	FOREIGN KEY (`candidate_id`) REFERENCES `short_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`idea_id`) REFERENCES `inspiration_ideas`(`id`) ON UPDATE no action ON DELETE no action
);
