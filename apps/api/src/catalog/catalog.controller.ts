import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  catalogListResponseSchema,
  catalogProductResponseSchema,
  createCatalogProductRequestSchema,
  updateCatalogProductRequestSchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { CatalogService } from '@glorychips/database';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import type { ApiRequest, ApiResponse } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CATALOG_SERVICE, PRODUCT_IMAGE_CONTENT_PROVIDER } from '../auth/tokens.js';
import type { ProductImageContentProvider } from './product-image.provider.js';

const includeInactiveSchema = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

@Controller('catalog')
export class CatalogController {
  public constructor(
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(PRODUCT_IMAGE_CONTENT_PROVIDER)
    private readonly imageContent: ProductImageContentProvider,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  public async list(@Query('includeInactive') rawIncludeInactive: unknown) {
    const includeInactive = includeInactiveSchema.safeParse(rawIncludeInactive);
    if (!includeInactive.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The catalog filter is invalid.');
    }
    return catalogListResponseSchema.parse(await this.catalog.listCatalog(includeInactive.data));
  }

  @Get('selectable')
  @UseGuards(SessionGuard)
  public async listSelectable() {
    return catalogListResponseSchema.parse(await this.catalog.listSelectableCatalog());
  }

  @Get('images/:imageId')
  @UseGuards(SessionGuard)
  public async loadImage(
    @Param('imageId') imageId: string,
    @Req() request: ApiRequest,
    @Res() response: ApiResponse,
  ): Promise<void> {
    if (!z.uuid().safeParse(imageId).success || request.auth === undefined) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The product image id is invalid.');
    }
    const image = await this.catalog.getImageReference(imageId);
    const content = await this.imageContent.load({
      attachmentToken: image.attachmentToken,
      fileName: image.fileName,
    });
    response.setHeader('Content-Type', content.contentType);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (content.etag !== undefined) response.setHeader('ETag', content.etag);
    response.send(Buffer.from(content.body));
  }

  @Post()
  @UseGuards(SessionGuard, SystemAdminGuard)
  public async create(@Body() rawBody: unknown) {
    const body = createCatalogProductRequestSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The product request is invalid.');
    }
    return catalogProductResponseSchema.parse(await this.catalog.createProduct(body.data));
  }

  @Put(':productId')
  @UseGuards(SessionGuard, SystemAdminGuard)
  public async update(@Param('productId') productId: string, @Body() rawBody: unknown) {
    const body = updateCatalogProductRequestSchema.safeParse(rawBody);
    if (!z.uuid().safeParse(productId).success || !body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The product update request is invalid.');
    }
    return catalogProductResponseSchema.parse(
      await this.catalog.updateProduct(productId, body.data),
    );
  }
}
