CREATE TABLE `course_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int,
	`supervisorId` int NOT NULL,
	`courseId` int NOT NULL,
	`listenDate` timestamp,
	`actualWeek` int,
	`overallScore` float,
	`score_teaching_content` int,
	`score_course_objective` int,
	`score_reference_sharing` int,
	`score_literature_humanities` int,
	`score_teaching_organization` int,
	`score_course_development` int,
	`score_course_focus` int,
	`score_language_logic` int,
	`score_interaction` int,
	`score_learning_preparation` int,
	`score_teaching_quality` int,
	`score_active_response` int,
	`score_student_centered` int,
	`score_research_teaching` int,
	`score_learning_effect` int,
	`score_interaction_quality` int,
	`score_method_diversity` int,
	`score_equal_dialogue` int,
	`score_pace_control` int,
	`score_feedback` int,
	`text_highlight` text,
	`text_improvement` text,
	`text_good_experience` text,
	`text_improve_suggestion` text,
	`text_improve_direction` text,
	`text_other_suggestion` text,
	`status` enum('draft','submitted') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `course_evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`academicYear` varchar(16),
	`semester` varchar(32),
	`college` varchar(128),
	`courseName` varchar(256),
	`courseType` varchar(64),
	`classroom` varchar(128),
	`classId` varchar(64),
	`teacher` varchar(64),
	`campus` varchar(32),
	`weekday` varchar(16),
	`weekType` varchar(128),
	`period` varchar(64),
	`customWeeks` text,
	`weekNumbers` json,
	`studentMajor` text,
	`studentCount` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `courses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listening_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supervisorId` int NOT NULL,
	`courseId` int NOT NULL,
	`planWeek` int,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listening_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientId` int NOT NULL,
	`senderId` int DEFAULT 0,
	`type` enum('evaluation_complete','plan_reminder','system') NOT NULL,
	`title` varchar(256) NOT NULL,
	`content` text,
	`evaluationId` int,
	`planId` int,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('supervisor_expert','supervisor_leader','college_secretary','graduate_admin','user','admin') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `employeeId` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `college` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `remark` varchar(256);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_employeeId_unique` UNIQUE(`employeeId`);