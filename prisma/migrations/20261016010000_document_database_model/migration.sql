-- Refuse to discard old demo posts or truncate existing names.
-- The temporary guard disappears on disconnect if validation fails.
CREATE TEMPORARY TABLE `_durak_migration_guard` (
    `safe_to_migrate` INTEGER NOT NULL CHECK (`safe_to_migrate` = 1)
);
INSERT INTO `_durak_migration_guard` (`safe_to_migrate`)
SELECT IF(
    NOT EXISTS (SELECT 1 FROM `Post`)
    AND NOT EXISTS (SELECT 1 FROM `User` WHERE CHAR_LENGTH(`name`) > 50),
    1, 0
);
DROP TEMPORARY TABLE `_durak_migration_guard`;

-- Post is the unused Prisma demo table, not part of the document's model.
DROP TABLE `Post`;
ALTER TABLE `Session` DROP FOREIGN KEY `Session_userId_fkey`;

-- Preserve accounts, password hashes, IDs and sessions while renaming fields.
RENAME TABLE `User` TO `Lietotaji`;
ALTER TABLE `Lietotaji`
    CHANGE COLUMN `id` `lietotaja_id` BIGINT NOT NULL AUTO_INCREMENT,
    CHANGE COLUMN `email` `epasts` VARCHAR(255) NOT NULL,
    CHANGE COLUMN `passwordHash` `paroles_jaucejvertiba` VARCHAR(255) NOT NULL,
    CHANGE COLUMN `name` `vards` VARCHAR(50) NULL,
    ADD COLUMN `lietotajvards` VARCHAR(50) NULL,
    ADD COLUMN `avatars` VARCHAR(255) NULL,
    ADD COLUMN `tema` ENUM('LIGHT', 'DARK') NOT NULL DEFAULT 'DARK',
    ADD COLUMN `tiesibas` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    ADD COLUMN `statuss` ENUM('ACTIVE', 'BANNED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `izveidots` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    RENAME INDEX `User_email_key` TO `Lietotaji_epasts_key`;

UPDATE `Lietotaji`
SET `lietotajvards` = CONCAT('legacy_', `lietotaja_id`),
    `vards` = COALESCE(NULLIF(TRIM(`vards`), ''), CONCAT('legacy_', `lietotaja_id`));

ALTER TABLE `Lietotaji`
    MODIFY COLUMN `lietotajvards` VARCHAR(50) NOT NULL,
    MODIFY COLUMN `vards` VARCHAR(50) NOT NULL,
    ADD UNIQUE INDEX `Lietotaji_lietotajvards_key` (`lietotajvards`);
ALTER TABLE `Session` MODIFY COLUMN `userId` BIGINT NOT NULL;

-- CreateTable
CREATE TABLE `Draudzibas` (
    `draudzibas_id` BIGINT NOT NULL AUTO_INCREMENT,
    `nosutitaja_id` BIGINT NOT NULL,
    `sanemeja_id` BIGINT NOT NULL,
    `statuss` ENUM('PENDING', 'ACCEPTED', 'DECLINED') NOT NULL DEFAULT 'PENDING',
    `izveidots` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Draudzibas_sanemeja_id_statuss_idx`(`sanemeja_id`, `statuss`),
    UNIQUE INDEX `Draudzibas_nosutitaja_id_sanemeja_id_key`(`nosutitaja_id`, `sanemeja_id`),
    PRIMARY KEY (`draudzibas_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Speles` (
    `speles_id` BIGINT NOT NULL AUTO_INCREMENT,
    `speles_rezims` VARCHAR(30) NOT NULL,
    `sakums` DATETIME(3) NOT NULL,
    `beigas` DATETIME(3) NOT NULL,

    PRIMARY KEY (`speles_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Speles_speletaji` (
    `speletaja_id` BIGINT NOT NULL AUTO_INCREMENT,
    `speles_id` BIGINT NOT NULL,
    `lietotaja_id` BIGINT NULL,
    `viesa_vards` VARCHAR(50) NULL,
    `rezultats` ENUM('WIN', 'DURAK') NOT NULL,

    INDEX `Speles_speletaji_lietotaja_id_idx`(`lietotaja_id`),
    UNIQUE INDEX `Speles_speletaji_speles_id_lietotaja_id_key`(`speles_id`, `lietotaja_id`),
    PRIMARY KEY (`speletaja_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Draudzibas` ADD CONSTRAINT `Draudzibas_nosutitaja_id_fkey` FOREIGN KEY (`nosutitaja_id`) REFERENCES `Lietotaji`(`lietotaja_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Draudzibas` ADD CONSTRAINT `Draudzibas_sanemeja_id_fkey` FOREIGN KEY (`sanemeja_id`) REFERENCES `Lietotaji`(`lietotaja_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Speles_speletaji` ADD CONSTRAINT `Speles_speletaji_speles_id_fkey` FOREIGN KEY (`speles_id`) REFERENCES `Speles`(`speles_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Speles_speletaji` ADD CONSTRAINT `Speles_speletaji_lietotaja_id_fkey` FOREIGN KEY (`lietotaja_id`) REFERENCES `Lietotaji`(`lietotaja_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Lietotaji`(`lietotaja_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants from the reference model.
ALTER TABLE `Draudzibas` ADD CONSTRAINT `Draudzibas_not_self`
    CHECK (`nosutitaja_id` <> `sanemeja_id`);
ALTER TABLE `Speles` ADD CONSTRAINT `Speles_time_order`
    CHECK (`beigas` >= `sakums`);
ALTER TABLE `Speles_speletaji` ADD CONSTRAINT `Speles_speletaji_identity`
    CHECK ((`lietotaja_id` IS NOT NULL AND `viesa_vards` IS NULL)
        OR (`lietotaja_id` IS NULL AND `viesa_vards` IS NOT NULL AND CHAR_LENGTH(TRIM(`viesa_vards`)) > 0));
