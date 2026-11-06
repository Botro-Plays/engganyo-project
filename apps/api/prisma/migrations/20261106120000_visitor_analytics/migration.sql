CREATE TABLE "visitor_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "visit_db_id" TEXT,
    "path" TEXT NOT NULL,
    "referrer_domain" TEXT,
    "country" TEXT,
    "device_class" TEXT NOT NULL,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_visits" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "page_views" INTEGER NOT NULL DEFAULT 1,
    "entry_path" TEXT NOT NULL,
    "exit_path" TEXT,
    "referrer_domain" TEXT,
    "country" TEXT,
    "device_class" TEXT NOT NULL,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily_visits" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "unique_visitors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "analytics_daily_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitor_events_event_id_key" ON "visitor_events"("event_id");

-- CreateIndex
CREATE INDEX "visitor_events_created_at_idx" ON "visitor_events"("created_at");

-- CreateIndex
CREATE INDEX "visitor_events_visit_id_created_at_idx" ON "visitor_events"("visit_id", "created_at");

-- CreateIndex
CREATE INDEX "visitor_events_path_created_at_idx" ON "visitor_events"("path", "created_at");

-- CreateIndex
CREATE INDEX "visitor_events_country_created_at_idx" ON "visitor_events"("country", "created_at");

-- CreateIndex
CREATE INDEX "visitor_events_referrer_domain_created_at_idx" ON "visitor_events"("referrer_domain", "created_at");

-- CreateIndex
CREATE INDEX "visitor_events_device_class_created_at_idx" ON "visitor_events"("device_class", "created_at");

-- CreateIndex
CREATE INDEX "visitor_events_is_bot_created_at_idx" ON "visitor_events"("is_bot", "created_at");

-- CreateIndex
CREATE INDEX "visitor_visits_visit_id_last_seen_at_idx" ON "visitor_visits"("visit_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "visitor_visits_started_at_idx" ON "visitor_visits"("started_at");

-- CreateIndex
CREATE INDEX "visitor_visits_is_bot_started_at_idx" ON "visitor_visits"("is_bot", "started_at");

-- CreateIndex
CREATE INDEX "visitor_visits_country_started_at_idx" ON "visitor_visits"("country", "started_at");

-- CreateIndex
CREATE INDEX "visitor_visits_referrer_domain_started_at_idx" ON "visitor_visits"("referrer_domain", "started_at");

-- CreateIndex
CREATE INDEX "visitor_visits_device_class_started_at_idx" ON "visitor_visits"("device_class", "started_at");

-- CreateIndex
CREATE INDEX "analytics_daily_visits_date_idx" ON "analytics_daily_visits"("date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_daily_visits_date_dimension_value_key" ON "analytics_daily_visits"("date", "dimension", "value");

-- AddForeignKey
ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_visit_db_id_fkey" FOREIGN KEY ("visit_db_id") REFERENCES "visitor_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

