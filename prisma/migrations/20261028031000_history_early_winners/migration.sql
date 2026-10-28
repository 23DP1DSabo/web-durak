-- Old games did not mark early finishers as WIN after they left the result screen.
-- Their NULL result was imported as DRAW; a round with a loser is not a draw.
UPDATE `Kartu_dalibnieki` p
JOIN `Spelu_kartas` r ON r.`id` = p.`roundId`
JOIN `Speles` m ON m.`speles_id` = r.`matchId` AND m.`sakums` = r.`startedAt`
SET p.`result` = 'WIN'
WHERE p.`result` = 'DRAW' AND m.`statuss` = 'FINISHED'
  AND (JSON_LENGTH(JSON_EXTRACT(m.`speles_stavoklis`, '$.result.losers')) > 0
    OR JSON_TYPE(JSON_EXTRACT(m.`speles_stavoklis`, '$.result.loser')) = 'STRING');
