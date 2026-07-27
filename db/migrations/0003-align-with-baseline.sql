BEGIN;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_area_sane;

ALTER TABLE jobs     DROP CONSTRAINT jobs_contact_id_fkey;
ALTER TABLE jobs     ADD  CONSTRAINT jobs_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE;

ALTER TABLE offers   DROP CONSTRAINT offers_job_id_fkey;
ALTER TABLE offers   ADD  CONSTRAINT offers_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT messages_contact_id_fkey;
ALTER TABLE messages ADD  CONSTRAINT messages_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT messages_job_id_fkey;
ALTER TABLE messages ADD  CONSTRAINT messages_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL;

ALTER TABLE pricing_rules DROP CONSTRAINT pricing_rules_key_unique;
ALTER TABLE pricing_rules ADD  CONSTRAINT pricing_rules_rule_key_key UNIQUE (rule_key);

CREATE UNIQUE INDEX IF NOT EXISTS services_label_unique ON services (lower(label));

COMMIT;
