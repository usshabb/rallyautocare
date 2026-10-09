CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `charges` ADD `tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `charges` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `charges` ADD `stripe_invoice_id` text;--> statement-breakpoint
ALTER TABLE `charges` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `charges_stripe_pi_idx` ON `charges` (`stripe_payment_intent_id`) WHERE stripe_payment_intent_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `charges_stripe_invoice_idx` ON `charges` (`stripe_invoice_id`) WHERE stripe_invoice_id is not null;--> statement-breakpoint
ALTER TABLE `memberships` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `autopay_from` text;--> statement-breakpoint
ALTER TABLE `users` ADD `stripe_customer_id` text;