import { Injectable } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';

export type OnboardingStepKey =
  | 'company'
  | 'location'
  | 'products'
  | 'bankAccount'
  | 'team'
  | 'firstInvoice';

// The getting-started checklist a new self-serve org sees (home page and
// /onboarding). Every step is read from the data itself — there is no
// per-step "done" flag to drift out of sync with what the business has
// actually set up. Only "finished or skipped" is stored.
@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private modules: OrganizationModulesService,
  ) {}

  async status(organizationId: string) {
    const [org, enabled, locations, products, bankAccounts, members, invoices] =
      await Promise.all([
        this.prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: {
            plan: true,
            onboardingCompletedAt: true,
            address: true,
            phone: true,
            legalName: true,
          },
        }),
        this.modules.getEnabledModules(organizationId),
        this.prisma.location.count({
          where: { organizationId, archivedAt: null },
        }),
        this.prisma.product.count({ where: { organizationId } }),
        this.prisma.organizationBankAccount.count({
          where: { organizationId },
        }),
        this.prisma.user.count({ where: { organizationId, removedAt: null } }),
        this.prisma.invoice.count({ where: { organizationId } }),
      ]);
    const selling = enabled.includes(ModuleKey.INVOICE_POS);

    const steps: {
      key: OnboardingStepKey;
      done: boolean;
      optional?: boolean;
    }[] = [
      { key: 'company', done: !!(org.address && org.phone) },
      { key: 'location', done: locations > 0 },
      { key: 'products', done: products > 0 },
      ...(selling
        ? [
            {
              key: 'bankAccount' as const,
              done: bankAccounts > 0,
              optional: true,
            },
          ]
        : []),
      { key: 'team', done: members > 1, optional: true },
      ...(selling
        ? [{ key: 'firstInvoice' as const, done: invoices > 0 }]
        : []),
    ];

    return {
      completedAt: org.onboardingCompletedAt,
      // Hand-managed orgs were set up with support; they never see the wizard.
      show: !org.onboardingCompletedAt && org.plan !== 'custom',
      steps,
    };
  }

  async complete(organizationId: string) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { onboardingCompletedAt: new Date() },
    });
    return this.status(organizationId);
  }
}
