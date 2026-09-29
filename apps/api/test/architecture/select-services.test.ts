/**
 * Choosing which services a host process runs (ENABLED_SERVICES, services.ts).
 */
import { Module } from '@nestjs/common';
import type { ServiceDefinition } from '@eduplatform/server-kit';
import { describe, expect, it } from 'vitest';
import { selectServices } from '../../src/services';

@Module({})
class EmptyModule {}

/** A minimal fake service for these tests. */
function fakeService(key: string, dependsOn: string[] = []): ServiceDefinition {
  return {
    manifest: {
      key,
      name: key,
      version: 1,
      category: 'academics',
      dependsOn,
      appliesTo: [],
      variants: [],
      permissions: [],
      events: { publishes: [], consumes: [] },
    },
    module: EmptyModule,
    migrationsDir: '',
  };
}

const registry = [
  fakeService('academic'),
  fakeService('students', ['academic']),
  fakeService('attendance', ['academic', 'students']),
];
const keys = (services: ServiceDefinition[]) => services.map((s) => s.manifest.key);

describe('selectServices', () => {
  it('runs every service when nothing is chosen', () => {
    expect(keys(selectServices([], registry))).toEqual(['academic', 'students', 'attendance']);
  });

  it('runs only the chosen services, in registry order', () => {
    expect(keys(selectServices(['students', 'academic'], registry))).toEqual([
      'academic',
      'students',
    ]);
  });

  it('refuses a service whose dependency was not chosen', () => {
    expect(() => selectServices(['students'], registry)).toThrow(/students needs academic/);
  });

  it('refuses unknown names and lists the available ones', () => {
    expect(() => selectServices(['studnets'], registry)).toThrow(
      /Unknown service\(s\).*studnets.*Available: academic, students, attendance/,
    );
  });
});
