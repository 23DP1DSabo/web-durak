CREATE TABLE `Profilu_atteli` (
  `lietotaja_id` BIGINT NOT NULL,
  `attels` MEDIUMBLOB NOT NULL,
  `kontrolsumma` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`lietotaja_id`),
  CONSTRAINT `Profilu_atteli_lietotaja_id_fkey` FOREIGN KEY (`lietotaja_id`)
    REFERENCES `Lietotaji` (`lietotaja_id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
