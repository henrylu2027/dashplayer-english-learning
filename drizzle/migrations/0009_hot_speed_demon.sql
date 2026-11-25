CREATE TABLE `dp_practice_attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`source_kind` text NOT NULL,
	`video_key` text,
	`sentence_index` integer,
	`video_path` text,
	`subtitle_path` text,
	`reference_text` text NOT NULL,
	`user_text` text NOT NULL,
	`score` integer NOT NULL,
	`word_feedback` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dp_practice_attempt_created_at_idx` ON `dp_practice_attempt` (`created_at`);--> statement-breakpoint
CREATE INDEX `dp_practice_attempt_mode_created_at_idx` ON `dp_practice_attempt` (`mode`,`created_at`);