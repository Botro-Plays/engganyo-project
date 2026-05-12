-- Engganyo PostgreSQL initialization script
-- Runs once on first container startup

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search on usernames/bios

-- Set timezone
SET timezone = 'UTC';
