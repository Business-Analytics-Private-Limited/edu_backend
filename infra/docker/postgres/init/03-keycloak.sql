-- LOCAL DEVELOPMENT ONLY. Keycloak gets its own database; it has no access to ours (ADR-0003).
create role keycloak login password 'keycloak';
create database keycloak owner keycloak;
