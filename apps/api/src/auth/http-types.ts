import type { SessionPrincipal } from '@glorychips/database';

export interface ApiRequest {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  auth?: SessionPrincipal;
}

export interface ApiResponse {
  redirect(status: number, url: string): void;
  setHeader(name: string, value: string | readonly string[]): void;
  status(status: number): ApiResponse;
  json(body: unknown): void;
}
