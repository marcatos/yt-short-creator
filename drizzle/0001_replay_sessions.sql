CREATE TABLE `replay_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`rpy_path` text NOT NULL,
	`ibt_path` text,
	`media_path` text,
	`track_name` text,
	`focus_car_idx` integer,
	`title` text NOT NULL,
	`duration_sec` integer,
	`status` text NOT NULL,
	`events` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
