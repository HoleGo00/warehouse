import type { OutboxStatus, OutboxStepTarget, SyncJob } from '@glorychips/contracts';
import { ApiClientError } from '../shared/api-client.js';

export const targetLabels: Record<OutboxStepTarget, string> = {
  RING_BASE: '指环',
  WATCH_BASE: '腕表',
};
export const statusLabels: Record<OutboxStatus, string> = {
  PENDING: '待同步',
  PROCESSING: '同步中',
  SUCCEEDED: '已同步',
  RETRY: '等待重试',
  MANUAL_REVIEW: '需人工处理',
};
const errorLabels: Record<string, string> = {
  SYNC_BINDING_INVALID: '同步表配置异常',
  SYNC_REMOTE_CONFLICT: '飞书记录不一致',
  SYNC_REMOTE_UNCERTAIN: '远端结果待确认',
  SYNC_ORDER_BLOCKED: '等待前序流水',
  SYNC_LEASE_LOST: '处理租约已失效',
  SYNC_REMOTE_UNAVAILABLE: '飞书服务暂时不可用',
  SYNC_LOCAL_INVARIANT: '本地库存校验失败',
  SYNC_JOB_NOT_FOUND: '同步任务不存在',
  SYNC_STATE_CONFLICT: '任务状态已变化，请刷新',
  IDEMPOTENCY_CONFLICT: '操作内容已变化，请重新提交',
  FORBIDDEN_ROLE: '仅系统管理员可操作',
  AUTH_REQUIRED: '登录已失效',
};
export const syncErrorLabel = (code: string | null): string =>
  code ? (errorLabels[code] ?? '同步异常') : '无';
export const syncActionError = (error: unknown): string =>
  error instanceof ApiClientError ? syncErrorLabel(error.code) : '操作未完成，请重试';
export const jobStatusLabel = (job: SyncJob): string =>
  job.status !== 'SUCCEEDED' && job.steps.some((step) => step.status === 'SUCCEEDED')
    ? `部分已同步 · ${statusLabels[job.status]}`
    : statusLabels[job.status];
export const syncDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
