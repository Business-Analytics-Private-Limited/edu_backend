/**
 * THE ROOT MODULE: lists everything the app is made of.
 *
 * Every request goes through, in this order:
 *   1. RequestLoggerMiddleware   logs the request
 *   2. ThrottlerGuard            too many requests from one address? → 429
 *   3. JwtAuthGuard              logged in? (token checked)            → 401
 *   4. AccessGuard               allowed? (the endpoint's decorator)   → 403
 *   5. the controller method → its service → the database
 *
 * To add a feature: create src/modules/<feature>/ (module, controller, service, dto) and add
 * its module to `imports` below.
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessGuard } from './common/guards/access.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AcademicModule } from './modules/academic/academic.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { RolesModule } from './modules/roles/roles.module';
import { StudentsModule } from './modules/students/students.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // Reads .env into process.env and makes ConfigService available everywhere.
    ConfigModule.forRoot({ isGlobal: true }),
    // Default limit: 300 requests per minute per address (login routes have a lower limit).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,

    // Features
    HealthModule,
    AuthModule,
    SuperAdminModule, // the super admin area
    OrganizationModule, // the tenant admin area
    UsersModule,
    AcademicModule,
    StudentsModule,
    RolesModule,
  ],
  providers: [
    // Guards run before every endpoint, in this order.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}
