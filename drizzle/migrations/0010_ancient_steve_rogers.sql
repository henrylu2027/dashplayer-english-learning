CREATE TABLE `dp_dialogue_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_session_id` text NOT NULL,
	`video_key` text,
	`sentence_index` integer,
	`video_path` text,
	`subtitle_path` text,
	`anchor_text` text NOT NULL,
	`title` text NOT NULL,
	`scene_json` text NOT NULL,
	`difficulty` text NOT NULL,
	`backend` text NOT NULL,
	`status` text NOT NULL,
	`review_json` text,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `dp_dialogue_session_created_at_idx` ON `dp_dialogue_session` (`created_at`);--> statement-breakpoint
CREATE INDEX `dp_dialogue_session_chat_session_id_idx` ON `dp_dialogue_session` (`chat_session_id`);--> statement-breakpoint
CREATE TABLE `dp_dialogue_turn` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`card_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dp_dialogue_turn_session_idx` ON `dp_dialogue_turn` (`session_id`,`created_at`);