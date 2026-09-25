CREATE TABLE "airports" (
	"iata" text PRIMARY KEY NOT NULL,
	"icao" text,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"timezone" text,
	"region" text DEFAULT 'other' NOT NULL,
	"metro_code" text
);
--> statement-breakpoint
CREATE TABLE "flight_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"operating_date" text NOT NULL,
	"departure_local" text,
	"arrival_local" text,
	"flight_number" text,
	"source_id" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metro_areas" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"primary_airports" jsonb NOT NULL,
	"nearby_airports" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program" text NOT NULL,
	"rule_key" text NOT NULL,
	"summary" text NOT NULL,
	"value" jsonb NOT NULL,
	"source_url" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"effective_date" text
);
--> statement-breakpoint
CREATE TABLE "route_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_iata" text,
	"destination_iata" text,
	"title" text NOT NULL,
	"url" text,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"kind" text NOT NULL,
	"announced_start" text,
	"announced_end" text,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"change_type" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"confidence" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"metric_kind" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"period_label" text NOT NULL,
	"value" integer NOT NULL,
	"unit" text NOT NULL,
	"source_id" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"domestic_comparable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"url" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"last_retrieved_at" timestamp with time zone NOT NULL,
	"external_id" text NOT NULL,
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"observation_kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"projection" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"status" text NOT NULL,
	"confidence" text NOT NULL,
	"end_confirmed" boolean DEFAULT false NOT NULL,
	"launch_unverified" boolean DEFAULT false NOT NULL,
	"seasonal" boolean DEFAULT false NOT NULL,
	"reasons" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"first_scheduled_departure" text,
	"last_scheduled_departure" text,
	"announced_start_date" text,
	"announced_end_date" text,
	"announced_frequency_per_week" integer,
	"current_frequency_per_week" integer,
	"previous_frequency_per_week" integer,
	"schedule_days" jsonb NOT NULL,
	"schedule_horizon" text,
	"last_verified_at" timestamp with time zone,
	"suspected_end_date" text,
	"latest_marketed_departure" text,
	"projection" jsonb NOT NULL,
	CONSTRAINT "routes_origin_iata_destination_iata_pk" PRIMARY KEY("origin_iata","destination_iata")
);
--> statement-breakpoint
CREATE TABLE "saved_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_iata" text NOT NULL,
	"destination_iata" text NOT NULL,
	"label" text NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cache" (
	"source_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "source_cache_source_id_cache_key_pk" PRIMARY KEY("source_id","cache_key")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" integer NOT NULL,
	"kind" text NOT NULL,
	"base_url" text
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"source_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"records_observed" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "flight_instances_date_idx" ON "flight_instances" USING btree ("operating_date","origin_iata");--> statement-breakpoint
CREATE INDEX "route_announcements_pair_idx" ON "route_announcements" USING btree ("origin_iata","destination_iata");--> statement-breakpoint
CREATE INDEX "route_changes_detected_idx" ON "route_changes" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "route_metrics_period_idx" ON "route_metrics" USING btree ("metric_kind","period_start","origin_iata");--> statement-breakpoint
CREATE UNIQUE INDEX "route_observations_hash_idx" ON "route_observations" USING btree ("source_id","external_id","origin_iata","destination_iata","content_hash");--> statement-breakpoint
CREATE INDEX "route_observations_pair_idx" ON "route_observations" USING btree ("origin_iata","destination_iata");--> statement-breakpoint
CREATE INDEX "route_snapshots_pair_idx" ON "route_snapshots" USING btree ("origin_iata","destination_iata","captured_at");--> statement-breakpoint
CREATE INDEX "routes_status_idx" ON "routes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_routes_pair_idx" ON "saved_routes" USING btree ("origin_iata","destination_iata");--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source_id","started_at");