-- ADR-0033: the hidden "whole course" level of a Degree / Engineering course without specializations.

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "placeholder" BOOLEAN NOT NULL DEFAULT false;

