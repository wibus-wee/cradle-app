ALTER TABLE `node_session_links`
ADD `projection_kind` text DEFAULT 'controller-created' NOT NULL;
