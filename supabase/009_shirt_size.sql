-- Migration 009 — add employees.shirt_size (Item 7). Idempotent.
-- Run in the Supabase SQL editor. RLS on employees is already enabled (004b);
-- a column addition needs no policy change.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS shirt_size text;
