import { createHash, timingSafeEqual } from 'node:crypto';

export const OAUTH_CALLBACK_COOKIE_PATH = '/auth/feishu/oauth/callback';

export const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
};

interface CookieOptions {
  readonly maxAgeSeconds: number;
  readonly secure: boolean;
}

const serializeCookie = (
  name: string,
  value: string,
  path: string,
  options: CookieOptions,
): string => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
};

export const serializeSessionCookie = (
  name: string,
  value: string,
  options: CookieOptions,
): string => {
  return serializeCookie(name, value, '/', options);
};

export const serializeOAuthBindingCookie = (
  name: string,
  value: string,
  options: CookieOptions,
): string => serializeCookie(name, value, OAUTH_CALLBACK_COOKIE_PATH, options);

const serializeExpiredCookie = (name: string, path: string, secure: boolean): string => {
  const parts = [
    `${name}=`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

export const serializeExpiredSessionCookie = (name: string, secure: boolean): string =>
  serializeExpiredCookie(name, '/', secure);

export const serializeExpiredOAuthBindingCookie = (name: string, secure: boolean): string =>
  serializeExpiredCookie(name, OAUTH_CALLBACK_COOKIE_PATH, secure);

export const constantTimeSecretEqual = (left: string, right: string): boolean => {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
};
