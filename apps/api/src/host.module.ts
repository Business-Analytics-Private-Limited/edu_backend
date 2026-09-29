/**
 * Things the host gives to every service, made global so services can inject them:
 *
 *   MODULE_MANIFESTS  the manifests of all services this host knows (for the module catalog)
 *
 * The database pools are provided by DatabaseModule, which is global as well.
 */
import { Global, Module } from '@nestjs/common';
import { MODULE_MANIFESTS } from '@eduplatform/platform-service/public';
import { ALL_SERVICES } from './services';

@Global()
@Module({
  providers: [
    {
      provide: MODULE_MANIFESTS,
      // All services, not only ENABLED_SERVICES: the catalog describes the whole product.
      useValue: ALL_SERVICES.map((service) => service.manifest),
    },
  ],
  exports: [MODULE_MANIFESTS],
})
export class HostModule {}
