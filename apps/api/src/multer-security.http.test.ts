import 'reflect-metadata';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

const require = createRequire(import.meta.url);
const adapterRequire = createRequire(require.resolve('@nestjs/platform-express'));
const multerEntry = adapterRequire.resolve('multer');
const execute = promisify(execFile);
const fixture = fileURLToPath(new URL('../test-fixtures/multer-security.mjs', import.meta.url));
const fieldLimits = { fields: 4, fieldArrayIndexLimit: 4 };

@Controller()
class UploadTestController {
  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16, files: 1 } }))
  upload(@UploadedFile() file: { size: number; originalname: string }) {
    return { size: file.size, name: file.originalname };
  }

  @Post('fields')
  @UseInterceptors(FileInterceptor('file', { limits: fieldLimits }))
  fields() {
    return { ok: true };
  }
}

describe('Nest adapter Multer security compatibility', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadTestController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves the patched dependency from the API and worker adapter paths', () => {
    expect(adapterRequire('multer/package.json').version).toBe('2.3.0');
    const workerRequire = createRequire(new URL('../../worker/package.json', import.meta.url));
    const coreRequire = createRequire(workerRequire.resolve('@nestjs/core'));
    const workerAdapterRequire = createRequire(coreRequire.resolve('@nestjs/platform-express'));
    expect(workerAdapterRequire.resolve('multer')).toBe(multerEntry);
  });

  it('accepts a valid file at the configured size limit through the real Nest interceptor', async () => {
    const response = await request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.alloc(16, 'a'), 'valid.txt')
      .expect(201);
    expect(response.body).toEqual({ size: 16, name: 'valid.txt' });
  });

  it('maps an oversized upload to HTTP 413 and keeps serving requests', async () => {
    await request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.alloc(17, 'a'), 'large.txt')
      .expect(413);
    await request(app.getHttpServer()).get('/health').expect(200, { ok: true });
  });

  it('rejects an unexpected file field through the Nest interceptor', async () => {
    await request(app.getHttpServer())
      .post('/upload')
      .attach('unexpected', Buffer.from('a'), 'file.txt')
      .expect(400);
    await request(app.getHttpServer()).get('/health').expect(200, { ok: true });
  });

  it('forwards the array-index bound, with the current Nest error-mapping limitation', async () => {
    await request(app.getHttpServer()).post('/fields').field('items[4]', 'x').expect(201);
    // Nest 12.0.1 does not map LIMIT_FIELD_ARRAY_INDEX to a BadRequestException yet.
    await request(app.getHttpServer()).post('/fields').field('items[5]', 'x').expect(500);
    await request(app.getHttpServer()).get('/health').expect(200, { ok: true });
  });

  it.each([
    'crafted-field-names',
    'array-index-limit',
    'async-file-size',
    'aborted-disk-upload',
    'truncated-disk-upload',
  ])(
    'handles %s in a bounded process using the adapter-resolved parser',
    async (scenario) => {
      const tempRoot = await realpath(tmpdir());
      const directory = await mkdtemp(join(tempRoot, 'warehouse-multer-security-'));
      onTestFinished(async () => {
        const target = await realpath(directory);
        const child = relative(tempRoot, target);
        if (
          target !== resolve(directory) ||
          isAbsolute(child) ||
          child.startsWith('..') ||
          !child
        ) {
          throw new Error('Refusing to remove a test directory outside the temporary root');
        }
        await rm(target, { recursive: true, force: true });
      });
      // An in-process timeout cannot recover from a parser blocking the event loop.
      const result = await execute(process.execPath, [fixture, scenario, multerEntry, directory], {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({ scenario, ok: true });
    },
    15_000,
  );
});
