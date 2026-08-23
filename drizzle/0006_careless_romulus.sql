CREATE TABLE `semesters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`academicYear` varchar(16) NOT NULL,
	`name` varchar(32) NOT NULL,
	`startDate` varchar(10) NOT NULL,
	`totalWeeks` int NOT NULL DEFAULT 19,
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `semesters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `course_evaluations` ADD `semesterId` int;--> statement-breakpoint
ALTER TABLE `listening_plans` ADD `semesterId` int;--> statement-breakpoint
INSERT INTO `semesters` (`academicYear`, `name`, `startDate`, `totalWeeks`, `isActive`) VALUES ('2025-2026', '第二学期', '2026-03-02', 19, true);--> statement-breakpoint
UPDATE `course_evaluations` SET `semesterId` = (SELECT `id` FROM `semesters` WHERE `isActive` = true LIMIT 1) WHERE `semesterId` IS NULL;--> statement-breakpoint
UPDATE `listening_plans` SET `semesterId` = (SELECT `id` FROM `semesters` WHERE `isActive` = true LIMIT 1) WHERE `semesterId` IS NULL;
