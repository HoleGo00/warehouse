import type { PrismaClient } from '../generated/prisma/client.js';

export class WarehouseDirectoryService {
  public constructor(private readonly database: PrismaClient) {}

  public async listActive() {
    const warehouses = await this.database.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, publicSlug: true },
    });
    return warehouses.sort((left, right) => left.code.localeCompare(right.code));
  }
}
