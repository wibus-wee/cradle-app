CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	`message_id` UNINDEXED,
	`session_id` UNINDEXED,
	`session_title`,
	`searchable_text`
);--> statement-breakpoint
CREATE VIRTUAL TABLE `sessions_fts` USING fts5(
	`session_id` UNINDEXED,
	`title`
);--> statement-breakpoint
CREATE TRIGGER `sessions_fts_session_insert` AFTER INSERT ON `sessions` BEGIN
	INSERT INTO `sessions_fts` (`session_id`, `title`) VALUES (new.`id`, new.`title`);
END;--> statement-breakpoint
CREATE TRIGGER `sessions_fts_session_update` AFTER UPDATE OF `title` ON `sessions` BEGIN
	DELETE FROM `sessions_fts` WHERE `session_id` = old.`id`;
	INSERT INTO `sessions_fts` (`session_id`, `title`) VALUES (new.`id`, new.`title`);
END;--> statement-breakpoint
CREATE TRIGGER `sessions_fts_session_delete` AFTER DELETE ON `sessions` BEGIN
	DELETE FROM `sessions_fts` WHERE `session_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_message_insert` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts` (`message_id`, `session_id`, `session_title`, `searchable_text`)
	SELECT new.`id`, new.`session_id`, `sessions`.`title`, `chat_message_payloads`.`content`
	FROM `sessions`
	INNER JOIN `chat_message_payloads` ON `chat_message_payloads`.`id` = new.`payload_id`
	WHERE `sessions`.`id` = new.`session_id`
		AND length(trim(`chat_message_payloads`.`content`)) > 0;
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_message_update` AFTER UPDATE OF `session_id`, `payload_id`, `status` ON `messages` BEGIN
	DELETE FROM `messages_fts` WHERE `message_id` = old.`id`;
	INSERT INTO `messages_fts` (`message_id`, `session_id`, `session_title`, `searchable_text`)
	SELECT new.`id`, new.`session_id`, `sessions`.`title`, `chat_message_payloads`.`content`
	FROM `sessions`
	INNER JOIN `chat_message_payloads` ON `chat_message_payloads`.`id` = new.`payload_id`
	WHERE `sessions`.`id` = new.`session_id`
		AND length(trim(`chat_message_payloads`.`content`)) > 0;
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_message_delete` AFTER DELETE ON `messages` BEGIN
	DELETE FROM `messages_fts` WHERE `message_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_payload_update` AFTER UPDATE OF `content` ON `chat_message_payloads` BEGIN
	DELETE FROM `messages_fts`
	WHERE `message_id` IN (
		SELECT `id` FROM `messages` WHERE `payload_id` = old.`id`
	);
	INSERT INTO `messages_fts` (`message_id`, `session_id`, `session_title`, `searchable_text`)
	SELECT `messages`.`id`, `messages`.`session_id`, `sessions`.`title`, new.`content`
	FROM `messages`
	INNER JOIN `sessions` ON `sessions`.`id` = `messages`.`session_id`
	WHERE `messages`.`payload_id` = new.`id`
		AND length(trim(new.`content`)) > 0;
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_session_title_update` AFTER UPDATE OF `title` ON `sessions` BEGIN
	DELETE FROM `messages_fts` WHERE `session_id` = old.`id`;
	INSERT INTO `messages_fts` (`message_id`, `session_id`, `session_title`, `searchable_text`)
	SELECT `messages`.`id`, `messages`.`session_id`, new.`title`, `chat_message_payloads`.`content`
	FROM `messages`
	INNER JOIN `chat_message_payloads` ON `chat_message_payloads`.`id` = `messages`.`payload_id`
	WHERE `messages`.`session_id` = new.`id`
		AND length(trim(`chat_message_payloads`.`content`)) > 0;
END;--> statement-breakpoint
INSERT INTO `messages_fts` (`message_id`, `session_id`, `session_title`, `searchable_text`)
SELECT `messages`.`id`, `messages`.`session_id`, `sessions`.`title`, `chat_message_payloads`.`content`
FROM `messages`
INNER JOIN `sessions` ON `sessions`.`id` = `messages`.`session_id`
INNER JOIN `chat_message_payloads` ON `chat_message_payloads`.`id` = `messages`.`payload_id`
WHERE length(trim(`chat_message_payloads`.`content`)) > 0;--> statement-breakpoint
INSERT INTO `sessions_fts` (`session_id`, `title`)
SELECT `id`, `title` FROM `sessions`;
