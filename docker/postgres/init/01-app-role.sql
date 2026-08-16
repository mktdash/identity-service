CREATE ROLE mktdash_identity_app
  LOGIN
  PASSWORD 'local_dev_app_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE mktdash_identity TO mktdash_identity_app;
GRANT USAGE ON SCHEMA public TO mktdash_identity_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM mktdash_identity_app;

ALTER DEFAULT PRIVILEGES FOR ROLE mktdash_identity_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mktdash_identity_app;

ALTER DEFAULT PRIVILEGES FOR ROLE mktdash_identity_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mktdash_identity_app;

ALTER DEFAULT PRIVILEGES FOR ROLE mktdash_identity_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO mktdash_identity_app;
