import { cp, mkdir } from 'node:fs/promises';
import { URL } from 'node:url';

await mkdir(new URL('../dist/generated/', import.meta.url), { recursive: true });
await cp(
  new URL('../src/generated/prisma/', import.meta.url),
  new URL('../dist/generated/prisma/', import.meta.url),
  { recursive: true },
);
