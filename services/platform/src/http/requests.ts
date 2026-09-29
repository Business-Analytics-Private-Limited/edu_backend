/**
 * Request body and query schemas of the platform endpoints. They mirror the request schemas
 * in packages/contracts/openapi/platform.yaml: change both together.
 *
 * `.strict()` rejects unknown fields (docs/08-api-conventions.md §8.7).
 */
import { z } from 'zod';

const contact = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(20).optional(),
    email: z.email().max(200).optional(),
  })
  .strict();

export const createTenantSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(40)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes only'),
    legalName: z.string().trim().min(2).max(200),
    displayName: z.string().trim().min(2).max(100),
    primaryContact: contact.optional(),
  })
  .strict();

export const updateTenantSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200).optional(),
    displayName: z.string().trim().min(2).max(100).optional(),
    primaryContact: contact.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

const code = z.string().regex(/^[A-Z0-9_-]{2,20}$/, '2–20 capital letters, digits, _ or -');

export const addInstitutionSchema = z
  .object({
    code,
    name: z.string().trim().min(2).max(200),
    shortName: z.string().trim().max(50).optional(),
    type: z.enum(['junior_college', 'degree_college', 'engineering_college', 'school']),
    timezone: z
      .string()
      .refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), 'Unknown time zone')
      .optional(),
    campus: z.object({ code, name: z.string().trim().min(2).max(200) }).strict(),
  })
  .strict();

export const statusChangeSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const putEntitlementSchema = z
  .object({
    allowedVariants: z.array(z.string().min(1)).max(20).optional(),
    limits: z.record(z.string(), z.number().nonnegative()).optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const listTenantsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['onboarding', 'active', 'suspended', 'closed']).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export const moduleKeySchema = z.string().regex(/^[a-z_]+$/);
