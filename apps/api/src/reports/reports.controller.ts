import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  exportJobListSchema,
  exportJobResponseSchema,
  reportCandidatesQuerySchema,
  reportFiltersSchema,
  exportListQuerySchema,
  reportQuerySchema,
  staffQuerySchema,
} from '@glorychips/contracts';
import { AuthDomainError, ReportError } from '@glorychips/database';
import type { ExportService, ExportStorage, ReportService } from '@glorychips/database';
import { SessionGuard } from '../auth/session.guard.js';
import type { ApiRequest, ApiResponse } from '../auth/http-types.js';
import { parseIdempotencyKey, parseRequestId, requirePrincipal } from '../requests/request-http.js';
import { ReportWriteGuard } from './report-write.guard.js';
export const REPORT_SERVICE = Symbol('REPORT_SERVICE');
export const EXPORT_SERVICE = Symbol('EXPORT_SERVICE');
export const EXPORT_STORAGE = Symbol('EXPORT_STORAGE');
const parse = <T>(schema: z.ZodType<T>, raw: unknown) => {
  const result = schema.safeParse(raw);
  if (!result.success) throw new AuthDomainError('VALIDATION_ERROR', '查询条件无效。');
  return result.data;
};

@Controller('admin/reports')
@UseGuards(SessionGuard)
export class ReportsController {
  public constructor(@Inject(REPORT_SERVICE) private readonly reports: ReportService) {}
  @Get('requests')
  public query(@Query() raw: unknown, @Req() req: ApiRequest) {
    return this.reports.query(parse(reportQuerySchema, raw), requirePrincipal(req));
  }
  @Get('claimants')
  public claimants(@Query() raw: unknown, @Req() req: ApiRequest) {
    return this.reports.claimants(parse(reportCandidatesQuerySchema, raw), requirePrincipal(req));
  }
}
@Controller('requests')
@UseGuards(SessionGuard)
export class ReportMovementsController {
  public constructor(@Inject(REPORT_SERVICE) private readonly reports: ReportService) {}
  @Get(':id/movements')
  public movements(
    @Param('id') id: string,
    @Query('cursor') cursor: unknown,
    @Req() req: ApiRequest,
  ) {
    return this.reports.movements(
      parseRequestId(id),
      requirePrincipal(req),
      parse(z.uuid().optional(), cursor),
    );
  }
}
@Controller('access')
@UseGuards(SessionGuard)
export class StaffController {
  public constructor(@Inject(REPORT_SERVICE) private readonly reports: ReportService) {}
  @Get('users')
  public staff(@Query() raw: unknown, @Req() req: ApiRequest) {
    return this.reports.staff(parse(staffQuerySchema, raw), requirePrincipal(req));
  }
}
@Controller('admin/exports')
@UseGuards(SessionGuard)
export class ExportsController {
  public constructor(
    @Inject(EXPORT_SERVICE) private readonly exports: ExportService,
    @Inject(EXPORT_STORAGE) private readonly storage: ExportStorage,
  ) {}
  @Post()
  @UseGuards(ReportWriteGuard)
  public async create(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Req() req: ApiRequest,
  ) {
    return exportJobResponseSchema.parse(
      await this.exports.create(
        parse(reportFiltersSchema, body),
        parseIdempotencyKey(key),
        requirePrincipal(req),
      ),
    );
  }
  @Get()
  public async list(@Query() raw: unknown, @Req() req: ApiRequest) {
    return exportJobListSchema.parse(
      await this.exports.list(parse(exportListQuerySchema, raw), requirePrincipal(req)),
    );
  }
  @Get(':id')
  public async get(@Param('id') id: string, @Req() req: ApiRequest) {
    return exportJobResponseSchema.parse({
      job: await this.exports.get(parseRequestId(id), requirePrincipal(req)),
    });
  }
  @Get(':id/download')
  public async download(
    @Param('id') id: string,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const result = await this.exports.download(parseRequestId(id), requirePrincipal(req));
    try {
      const stream = await this.storage.reader(result.key);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return new StreamableFile(stream, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: `attachment; filename="${result.name}"`,
        length: result.size,
      });
    } catch {
      throw new ReportError('EXPORT_STORAGE', '文件暂不可读取，请重新导出。');
    }
  }
}
