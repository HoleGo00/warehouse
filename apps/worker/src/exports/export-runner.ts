import { AuthDomainError, ExportService, ExportStorage, ReportError } from '@glorychips/database';
import type { DatabaseClient } from '@glorychips/database';
import type { ExportEnvironment } from '@glorychips/config';
import { generateWorkbook } from './workbook.js';

export class ExportRunner {
  public readonly service: ExportService;
  public readonly storage: ExportStorage;
  public constructor(
    private readonly database: DatabaseClient,
    private readonly options: ExportEnvironment,
  ) {
    this.service = new ExportService(database);
    this.storage = new ExportStorage(options.EXPORT_STORAGE_DIR);
  }
  public async cleanup() {
    const expired = await this.service.expire();
    for (const job of expired) {
      if (job.fileKey) await this.storage.remove(job.fileKey);
      await this.database.requestExport.updateMany({
        where: { id: job.id, status: 'EXPIRED' },
        data: { fileKey: null },
      });
    }
    for (const file of await this.storage.files()) {
      if (file.modifiedAt.getTime() > Date.now() - 600_000) continue;
      const job = await this.database.requestExport.findUnique({ where: { id: file.jobId } });
      if (
        job?.fileKey === file.key &&
        job.status === 'SUCCEEDED' &&
        job.expiresAt &&
        job.expiresAt > new Date()
      )
        continue;
      if (
        job?.status === 'RUNNING' &&
        job.leaseToken === file.token &&
        job.leaseUntil &&
        job.leaseUntil > new Date()
      )
        continue;
      await this.storage.remove(file.key);
    }
  }
  public async runOnce() {
    const job = await this.service.claim();
    if (!job) return false;
    let key: string | null = null;
    const started = performance.now();
    let peakRss = process.memoryUsage().rss;
    const memoryTimer = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 100);
    try {
      const artifact = await generateWorkbook(this.database, job, this.storage, this.options);
      key = artifact.key;
      await this.service.complete(job, artifact);
      console.info(
        JSON.stringify({
          event: 'export_succeeded',
          jobId: job.id,
          elapsedMs: performance.now() - started,
          peakRss,
          fileSize: artifact.size,
          summaryCount: artifact.summaryCount,
          detailCount: artifact.detailCount,
        }),
      );
    } catch (error) {
      if (key) await this.storage.remove(key);
      const storageFailure =
        error instanceof Error &&
        'code' in error &&
        ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'ENOTDIR', 'EIO'].includes(String(error.code));
      const code =
        error instanceof ReportError || error instanceof AuthDomainError
          ? error.code
          : storageFailure
            ? 'EXPORT_STORAGE'
            : 'EXPORT_FAILED';
      await this.service.fail(
        job,
        code,
        !storageFailure && !(error instanceof ReportError || error instanceof AuthDomainError),
      );
      console.error(JSON.stringify({ event: 'export_failed', jobId: job.id, code }));
    } finally {
      clearInterval(memoryTimer);
    }
    return true;
  }
}
