import { usePolling } from './usePolling.js';
import { api } from '../api.js';

/** 桥接状态（4s 轮询）：Discord/DSH 在线状态、会话统计。 */
export function useStatus() {
  return usePolling(() => api.status(), 4000);
}
