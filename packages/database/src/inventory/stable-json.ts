import { createHash } from 'node:crypto';

const normalize = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }

  return value;
};

export const hashCommand = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
