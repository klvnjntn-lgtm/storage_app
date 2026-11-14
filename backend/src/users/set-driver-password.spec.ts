import * as bcrypt from 'bcrypt';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

// Admins set a driver's password (their login isn't a real inbox).
describe('UsersService.setDriverPassword', () => {
  const admin = { sub: 'admin-1', role: 'ADMIN', branchId: 'b1' };
  let users: Record<string, any>;
  let update: jest.Mock;
  let service: UsersService;

  beforeEach(() => {
    users = {
      d1: { id: 'd1', organizationId: 'org', role: 'DRIVER', branchId: null, removedAt: null },
      u1: { id: 'u1', organizationId: 'org', role: 'USER', branchId: 'b1', removedAt: null },
      dx: { id: 'dx', organizationId: 'other', role: 'DRIVER', branchId: null, removedAt: null },
    };
    update = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findFirst: jest.fn(({ where }) => {
          const u = users[where.id];
          return Promise.resolve(u && u.organizationId === where.organizationId ? u : null);
        }),
        update,
      },
    };
    service = new UsersService(prisma as any, {} as any, {} as any);
  });

  it('hashes the new password and ends the driver session', async () => {
    await service.setDriverPassword('org', admin, 'd1', 'newpass123');
    const data = update.mock.calls[0][0].data;
    expect(update.mock.calls[0][0].where).toEqual({ id: 'd1' });
    expect(await bcrypt.compare('newpass123', data.password)).toBe(true);
    expect(data.currentSessionId).toBeNull();
    expect(data.resetToken).toBeNull();
    expect(data.pendingPasswordHash).toBeNull();
  });

  it('refuses non-driver accounts', async () => {
    await expect(service.setDriverPassword('org', admin, 'u1', 'newpass123')).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("can't reach another organization's driver", async () => {
    await expect(service.setDriverPassword('org', admin, 'dx', 'newpass123')).rejects.toBeInstanceOf(NotFoundException);
  });
});
