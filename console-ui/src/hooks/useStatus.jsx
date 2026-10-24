import React, { createContext, useContext } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api.js';

const StatusContext = createContext({ status: null, error: null, refresh: () => {} });

/**
 * 全局桥接状态 Provider：整个应用只跑一个 /api/status 轮询（4s），
 * Layout 侧边栏和 Dashboard 共享同一份数据，避免重复请求和各刷各的。
 */
export function StatusProvider({ children }) {
  const { data, error, refresh } = usePolling(() => api.status(), 4000);
  return (
    <StatusContext.Provider value={{ status: data, error, refresh }}>
      {children}
    </StatusContext.Provider>
  );
}

export function useStatus() {
  return useContext(StatusContext);
}
