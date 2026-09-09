import { constants, createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ReportError } from './errors.js';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const keyPattern = new RegExp(`^(${uuid})\\.(${uuid})\\.(xlsx|partial)$`);
export class ExportStorage {
  public readonly root: string;
  public constructor(root: string) {
    this.root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)), root);
  }
  public async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ReportError('EXPORT_STORAGE', '导出目录必须是私有普通目录。');
    const probe = await open(join(this.root, `.probe-${process.pid}`), 'wx', 0o600);
    await probe.close();
    await unlink(join(this.root, `.probe-${process.pid}`));
  }
  private async path(key: string, mustExist = false) {
    if (!keyPattern.test(key) || basename(key) !== key)
      throw new ReportError('EXPORT_STORAGE', '导出文件标识无效。');
    const rootInfo = await lstat(this.root);
    if (rootInfo.isSymbolicLink()) throw new ReportError('EXPORT_STORAGE', '导出目录不可为链接。');
    const path = join(await realpath(this.root), key);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile())
        throw new ReportError('EXPORT_STORAGE', '导出文件类型无效。');
    } catch (e) {
      if (mustExist || !(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
    }
    return path;
  }
  public async writer(key: string) {
    const path = await this.path(key);
    return createWriteStream(path, { flags: 'wx', mode: 0o600 });
  }
  public async publish(partial: string, final: string) {
    const from = await this.path(partial, true);
    const to = await this.path(final);
    await rename(from, to);
  }
  public async info(key: string) {
    const path = await this.path(key, true);
    const info = await lstat(path);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return { size: info.size, hash: hash.digest('hex') };
  }
  public async reader(key: string) {
    const path = await this.path(key, true);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close();
      throw new ReportError('EXPORT_STORAGE', '导出文件无效。');
    }
    return file.createReadStream();
  }
  public async remove(key: string) {
    try {
      await unlink(await this.path(key, true));
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
    }
  }
  public async files() {
    const entries = await readdir(this.root, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((e) => e.isFile() && keyPattern.test(e.name))
        .map(async (e) => {
          const match = keyPattern.exec(e.name)!;
          const stat = await lstat(await this.path(e.name, true));
          return { key: e.name, jobId: match[1]!, token: match[2]!, modifiedAt: stat.mtime };
        }),
    );
  }
}
