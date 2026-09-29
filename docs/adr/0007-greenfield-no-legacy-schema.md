# ADR-0007: Greenfield build; legacy data enters only through the importer

Status: Accepted
Date: 2026-09-28

## Context

An earlier single-institute application exists on MySQL. Its schema is shaped around one institute (text codes as links, a fixed branch → type → group → stream → section chain, tables without auto-increment keys, no tenant key). Porting that schema would carry those limits into the new product.

## Decision

- The new platform is designed from scratch. No code or schema is copied from the earlier application. It serves only as a reference for requirements and field lists.
- Existing institutions' data (from the earlier application or any other system) is brought in through the **imports** module. It maps source files (CSV / Excel, or an export from the old database) into the new model through each module's public interface, with validation, a dry-run preview and a per-row error report.
- The same importer is used to onboard every new institution, so it is a product feature, not a one-time script.

## Consequences

- The new data model fits multi-tenancy and multiple institution types from day one.
- Migrating the first institution requires a mapping specification, from the old tables to import templates, to be written when that onboarding is planned.
