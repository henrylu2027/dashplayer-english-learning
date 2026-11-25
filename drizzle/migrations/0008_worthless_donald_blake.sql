CREATE TABLE `dp_srs_card` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_key` text NOT NULL,
	`source_kind` text NOT NULL,
	`video_key` text,
	`sentence_index` integer,
	`video_path` text,
	`subtitle_path` text,
	`reference_text` text NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL,
	`last_score` integer,
	`last_attempt_id` integer,
	`review_count` integer DEFAULT 0 NOT NULL,
	`pass_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_srs_card_key_unique` ON `dp_srs_card` (`card_key`);--> statement-breakpoint
CREATE INDEX `dp_srs_card_due_at_idx` ON `dp_srs_card` (`due_at`);