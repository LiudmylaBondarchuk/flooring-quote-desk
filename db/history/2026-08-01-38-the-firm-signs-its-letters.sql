-- The name the desk signs with.
--
-- "the flooring desk" said what the sender was rather than who it was, which is fine while nobody
-- has to act on a letter and wrong the moment somebody signs an agreement with the same outfit.
-- The name on the agreement and the name at the foot of the letters have to be one name.
--
-- The service area sits under it because that is the question people ask before any other, and a
-- signature is where they will already be looking.
--
-- One row, six letters. The letters themselves still speak as "I": one person does this work, and
-- writing "we" would say something about the firm that is not true.

UPDATE reply_templates
   SET body = E'\n\nBest,\nShoal Creek Flooring\nAustin, TX — and about thirty miles around it',
       updated_at = now()
 WHERE key = 'signature';
