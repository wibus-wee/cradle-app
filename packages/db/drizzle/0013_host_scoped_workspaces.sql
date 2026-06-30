ALTER TABLE `workspaces` ADD COLUMN `locator_json` text NOT NULL DEFAULT '{"hostId":"local","path":""}';
--> statement-breakpoint
ALTER TABLE `workspaces` ADD COLUMN `git_identity_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
UPDATE `workspaces`
SET `locator_json` = json_object('hostId', 'local', 'path', `path`);
--> statement-breakpoint
DROP INDEX `workspaces_path_unique`;
--> statement-breakpoint
ALTER TABLE `workspaces` DROP COLUMN `path`;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_locator_unique` ON `workspaces` (`locator_json`);
