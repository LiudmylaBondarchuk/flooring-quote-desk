-- Twenty-eight files in db/history and no record anywhere of which of them the database has
-- actually seen. Today one of them turned out never to have arrived: messages_matched_rule_known
-- was in the canon, in a migration, and absent from production, and nobody could have said when it
-- went missing or whether anything else had.
--
-- The ledger starts here rather than claiming to know the past. Every file present today is
-- recorded as applied, with the honest note that nobody watched it happen; from now on a file is
-- recorded at the moment it runs, by the thing that runs it.
--
-- The checksum is the point. A migration edited after it has run is the quietest way for a
-- repository and a database to disagree: the file says one thing, the database was built from
-- another, and every later reader trusts the file. The runner refuses when they differ.

BEGIN;

CREATE TABLE schema_migrations (
    filename    text        PRIMARY KEY,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    watched     boolean     NOT NULL DEFAULT true
);

COMMENT ON TABLE schema_migrations IS
    'Which files in db/history this database has run. One row per file, recorded by the runner at the moment it runs.';
COMMENT ON COLUMN schema_migrations.checksum IS
    'sha256 of the file as it was when it ran. A later edit to an applied migration makes the file and the database disagree, and the runner refuses rather than guessing which is right.';
COMMENT ON COLUMN schema_migrations.watched IS
    'False for the rows written when this table was created: those files were applied by hand over several days and nobody recorded it. True for everything the runner has done since.';

COMMIT;
