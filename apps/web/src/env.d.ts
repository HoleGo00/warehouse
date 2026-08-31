/// <reference types="vite/client" />

interface FeishuRequestAccessResult {
  readonly code: string;
}

interface FeishuRequestAccessOptions {
  readonly appID: string;
  readonly success: (result: FeishuRequestAccessResult) => void;
  readonly fail: (error: unknown) => void;
}

interface Window {
  readonly tt?: {
    readonly requestAccess?: (options: FeishuRequestAccessOptions) => void;
  };
}
