import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { inventoryQueryResponseSchema, inventoryQuerySchema } from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { InventoryQueryService } from '@glorychips/database';
import { SessionGuard } from '../auth/session.guard.js';
import { INVENTORY_QUERY_SERVICE } from '../auth/tokens.js';

@Controller('inventory')
export class InventoryController {
  public constructor(
    @Inject(INVENTORY_QUERY_SERVICE) private readonly inventory: InventoryQueryService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  public async query(@Query('warehouse') warehouse: unknown, @Query('category') category: unknown) {
    const query = inventoryQuerySchema.safeParse({ warehouse, category });
    if (!query.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The inventory query is invalid.');
    }
    return inventoryQueryResponseSchema.parse(await this.inventory.query(query.data));
  }
}
