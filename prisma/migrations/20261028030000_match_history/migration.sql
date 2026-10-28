CREATE TABLE `Spelu_kartas` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `matchId` BIGINT NOT NULL,
  `mode` VARCHAR(30) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `endedAt` DATETIME(3) NOT NULL,
  `reason` VARCHAR(30) NOT NULL,
  UNIQUE INDEX `Spelu_kartas_matchId_startedAt_key` (`matchId`, `startedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Spelu_kartas_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Speles` (`speles_id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Kartu_dalibnieki` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `roundId` BIGINT NOT NULL,
  `userId` BIGINT NULL,
  `guestName` VARCHAR(50) NULL,
  `result` VARCHAR(10) NOT NULL,
  UNIQUE INDEX `Kartu_dalibnieki_roundId_userId_key` (`roundId`, `userId`),
  INDEX `Kartu_dalibnieki_userId_id_idx` (`userId`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Kartu_dalibnieki_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `Spelu_kartas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Kartu_dalibnieki_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Lietotaji` (`lietotaja_id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Recover only completed, server-owned games still present in the old schema.
-- Earlier overwritten rematches and client-owned bot results cannot be recovered.
INSERT INTO `Spelu_kartas` (`matchId`, `mode`, `startedAt`, `endedAt`, `reason`)
SELECT `speles_id`, `speles_rezims`, `sakums`, `beigas`,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`speles_stavoklis`, '$.result.reason')), 'finished')
FROM `Speles`
WHERE `statuss` = 'FINISHED' AND `sakums` IS NOT NULL AND `beigas` IS NOT NULL
  AND JSON_TYPE(JSON_EXTRACT(`speles_stavoklis`, '$.result')) = 'OBJECT'
ORDER BY `beigas`, `speles_id`;
INSERT INTO `Kartu_dalibnieki` (`roundId`, `userId`, `guestName`, `result`)
SELECT r.`id`, p.`lietotaja_id`, IF(p.`lietotaja_id` IS NULL, p.`viesa_vards`, NULL), COALESCE(p.`result`, 'DRAW')
FROM `Spelu_kartas` r
JOIN `Speles` m ON m.`speles_id` = r.`matchId`
JOIN `Speles_speletaji` p ON p.`speles_id` = m.`speles_id`
WHERE JSON_CONTAINS(JSON_EXTRACT(m.`speles_stavoklis`, '$.players[*].id'), JSON_QUOTE(CAST(p.`speletaja_id` AS CHAR)))
ORDER BY r.`id`, p.`speletaja_id`;
