ALTER TABLE `dp_srs_card` ADD `word` text;--> statement-breakpoint
ALTER TABLE `dp_srs_card` ADD `source_modules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `dp_srs_card` ADD `priority` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
CREATE TABLE `dp_review_inbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_key` text NOT NULL,
	`reference_text` text NOT NULL,
	`source_kind` text NOT NULL,
	`video_key` text,
	`sentence_index` integer,
	`video_path` text,
	`subtitle_path` text,
	`word` text,
	`source_modules` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `dp_review_inbox_key_unique` ON `dp_review_inbox` (`card_key`);--> statement-breakpoint
CREATE INDEX `dp_review_inbox_priority_idx` ON `dp_review_inbox` (`priority`,`created_at`);
