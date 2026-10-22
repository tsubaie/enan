-- enan:compatible rebuilds notifications only to widen notifications_kind_check (ADMIN-B59); every column, index and foreign key is kept, and the previous release writes none of the new kinds.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`actor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notifications_kind_check" CHECK("__new_notifications"."kind" in ('task.assigned','task.due_today','task.overdue','note.mentioned','kpi.off_target','job.finished','update.installed','update.failed','update.rollback_failed','update.blocked','update.stalled'))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "kind", "subject_type", "subject_id", "payload", "actor_id", "created_at", "read_at") SELECT "id", "user_id", "kind", "subject_type", "subject_id", "payload", "actor_id", "created_at", "read_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notifications_feed_idx` ON `notifications` (`user_id`,`read_at`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `notifications_actor_idx` ON `notifications` (`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_unread_subject_idx` ON `notifications` (`user_id`,`kind`,`subject_id`) WHERE "notifications"."read_at" is null;