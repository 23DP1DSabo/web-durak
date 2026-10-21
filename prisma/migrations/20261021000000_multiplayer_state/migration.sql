-- Additive migration: existing rooms and accounts remain intact.
ALTER TABLE `Speles` ADD COLUMN `speles_stavoklis` JSON NULL, ADD COLUMN `versija` INTEGER NOT NULL DEFAULT 0;
