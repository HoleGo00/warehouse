import { Controller, Get, Inject, Param, Res, UseGuards } from '@nestjs/common';
import QRCode from 'qrcode';
import { warehouseCodeSchema } from '@glorychips/contracts';
import type { ApiEnvironment } from '@glorychips/config';
import { CatalogDomainError } from '@glorychips/database';
import type { WarehouseDirectoryService } from '@glorychips/database';
import type { ApiResponse } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { API_ENVIRONMENT, WAREHOUSE_DIRECTORY_SERVICE } from '../auth/tokens.js';
import { buildWarehouseEntriesResponse, findWarehouseEntry } from './warehouse-entry.js';

@Controller('warehouses')
export class WarehousesController {
  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(WAREHOUSE_DIRECTORY_SERVICE)
    private readonly warehouses: WarehouseDirectoryService,
  ) {}

  @Get('entries')
  @UseGuards(SessionGuard)
  public async listEntries() {
    return buildWarehouseEntriesResponse(this.environment, await this.warehouses.listActive());
  }

  @Get(':warehouseCode/qr.svg')
  @UseGuards(SessionGuard)
  public async qrCode(
    @Param('warehouseCode') rawWarehouseCode: string,
    @Res() response: ApiResponse,
  ): Promise<void> {
    const warehouseCode = warehouseCodeSchema.safeParse(rawWarehouseCode);
    if (!warehouseCode.success) {
      throw new CatalogDomainError('CATALOG_NOT_FOUND', 'The warehouse was not found.');
    }
    const entry = findWarehouseEntry(
      this.environment,
      await this.warehouses.listActive(),
      warehouseCode.data,
    );
    if (entry === null) {
      throw new CatalogDomainError('CATALOG_NOT_FOUND', 'The warehouse was not found.');
    }
    const svg = await QRCode.toString(entry.publicUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });
    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="warehouse-${entry.code.toLowerCase()}-apply.svg"`,
    );
    response.send(svg);
  }
}
