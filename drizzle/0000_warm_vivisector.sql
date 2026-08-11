CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`youtube_channel_id` text NOT NULL,
	`title` text NOT NULL,
	`connected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_youtube_channel_id_unique` ON `channels` (`youtube_channel_id`);--> statement-breakpoint
CREATE TABLE `generation_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`hook` text NOT NULL,
	`script` text NOT NULL,
	`voice_profile` text NOT NULL,
	`broll_plan` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `publish_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text NOT NULL,
	`youtube_video_id` text,
	`upload_session_url` text,
	`scheduled_at` integer,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `short_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publish_jobs_candidate_id_unique` ON `publish_jobs` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text NOT NULL,
	`output_path` text,
	`progress_pct` integer NOT NULL,
	`message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `short_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `render_jobs_candidate_id_unique` ON `render_jobs` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `short_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`score` real NOT NULL,
	`provenance` text NOT NULL,
	`render_output_path` text,
	`scheduled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`youtube_video_id` text NOT NULL,
	`title` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`local_media_path` text,
	`analytics_snapshot` text,
	`published_at` integer,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_videos_youtube_video_id_unique` ON `source_videos` (`youtube_video_id`);