CREATE TABLE `user_admin_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`adminName` varchar(128),
	`targetUserId` int NOT NULL,
	`targetName` varchar(128),
	`action` enum('role','extraRoles','college','supervisorScope') NOT NULL,
	`detail` varchar(512) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_admin_logs_id` PRIMARY KEY(`id`)
);
