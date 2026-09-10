import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  updateAccessRequestSchema,
  updateAccessResponseSchema,
  warehouseAccessProbeRequestSchema,
  warehouseAccessProbeResponseSchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { AuthServicePort } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AUTH_SERVICE } from '../auth/tokens.js';
import { assertWarehouseAccess } from './authorization.js';
import { SystemAdminGuard } from './system-admin.guard.js';
import { ReportWriteGuard } from '../reports/report-write.guard.js';

@Controller('access')
export class AccessController {
  public constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthServicePort) {}

  @Put('users/:userId')
  @UseGuards(SessionGuard, SystemAdminGuard, ReportWriteGuard)
  public async updateUserAccess(
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
    @Req() request: ApiRequest,
  ) {
    const accessResult = updateAccessRequestSchema.safeParse(rawBody);
    if (!accessResult.success || request.auth === undefined) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The access update request is invalid.');
    }
    if (!z.uuid().safeParse(userId).success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The target user id is invalid.');
    }
    const access = await this.auth.updateAccess(request.auth.userId, userId, accessResult.data);
    return updateAccessResponseSchema.parse({ userId, access });
  }

  @Get('warehouses/:warehouseCode/probe')
  @UseGuards(SessionGuard)
  public probeWarehouseFromUrl(
    @Param('warehouseCode') rawWarehouseCode: unknown,
    @Req() request: ApiRequest,
  ) {
    const warehouse = warehouseCodeSchema.safeParse(rawWarehouseCode);
    if (!warehouse.success || request.auth === undefined) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The warehouse code is invalid.');
    }
    assertWarehouseAccess(request.auth, warehouse.data);
    return warehouseAccessProbeResponseSchema.parse({ allowed: true, warehouse: warehouse.data });
  }

  @Post('warehouse-probe')
  @UseGuards(SessionGuard)
  public probeWarehouseFromBody(@Body() rawBody: unknown, @Req() request: ApiRequest) {
    const body = warehouseAccessProbeRequestSchema.safeParse(rawBody);
    if (!body.success || request.auth === undefined) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The warehouse request is invalid.');
    }
    assertWarehouseAccess(request.auth, body.data.warehouse);
    return warehouseAccessProbeResponseSchema.parse({
      allowed: true,
      warehouse: body.data.warehouse,
    });
  }
}
