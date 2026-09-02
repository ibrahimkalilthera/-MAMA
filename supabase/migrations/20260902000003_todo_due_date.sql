-- Migration: add an optional due date to to-dos so tasks can appear on the
-- calendar (grid badge + day-modal list) alongside financial events.
ALTER TABLE todos ADD COLUMN due_date date;