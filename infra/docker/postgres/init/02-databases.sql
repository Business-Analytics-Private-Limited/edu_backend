-- Docker only (on hold). Creates the application database after roles.sql has created the roles.
-- Without Docker, `pnpm db:setup` does the same thing.
create database eduplatform owner edu_owner;
revoke all on database eduplatform from public;
grant connect on database eduplatform to edu_app, edu_platform, edu_relay, edu_gateway;
