-- Migration 011 — add employees.termination_date (nullable). Idempotent.
-- Run in the Supabase SQL editor. RLS on employees already enabled (004b);
-- a column addition needs no policy change. date_of_hire already exists (001).
-- NOT NULL on date_of_hire is enforced at the APP layer (per spec), not here.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date date;
