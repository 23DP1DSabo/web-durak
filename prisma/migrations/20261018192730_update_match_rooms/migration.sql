/*
  Warnings:

  - You are about to drop the column `rezultats` on the `Speles_speletaji` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[istabas_kods]` on the table `Speles` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[speles_id,speletaja_atslega]` on the table `Speles_speletaji` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `istabas_kods` to the `Speles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Speles` ADD COLUMN `istabas_kods` VARCHAR(8) NOT NULL,
    ADD COLUMN `izveidots` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `laika_limits` INTEGER NOT NULL DEFAULT 600,
    ADD COLUMN `statuss` ENUM('WAITING', 'ACTIVE', 'FINISHED') NOT NULL DEFAULT 'WAITING',
    MODIFY `sakums` DATETIME(3) NULL,
    MODIFY `beigas` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Speles_speletaji` DROP COLUMN `rezultats`,
    ADD COLUMN `result` ENUM('WIN', 'DURAK') NULL,
    ADD COLUMN `speletaja_atslega` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Speles_istabas_kods_key` ON `Speles`(`istabas_kods`);

-- CreateIndex
CREATE INDEX `Speles_statuss_izveidots_idx` ON `Speles`(`statuss`, `izveidots`);

-- CreateIndex
CREATE UNIQUE INDEX `Speles_speletaji_speles_id_speletaja_atslega_key` ON `Speles_speletaji`(`speles_id`, `speletaja_atslega`);
