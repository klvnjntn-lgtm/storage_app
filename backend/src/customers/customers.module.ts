import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerLocationController } from './customer-location.controller';
import { CustomerLocationService } from './customer-location.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationModulesModule } from 'src/organization-module/organization-modules.module';

@Module({
  imports: [PrismaModule, OrganizationModulesModule],
  controllers: [CustomersController, CustomerLocationController],
  providers: [CustomersService, CustomerLocationService],
  exports: [CustomersService],
})
export class CustomersModule {}