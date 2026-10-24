import { useEffect, useRef, useState } from 'react';

/**
 * 通用轮询 hook：定时执行 async fn，组件卸载自动清理。
 * @param {() => Promise<T>} fn 轮询函数
 * @param {number} intervalMs 间隔
 * @param {boolean} enabled 是否启用（默认 true）
 * @returns {{ data, error, refresh }} refresh 可手动立即触发一轮
 */
export function usePolling(fn, intervalMs = 4000, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const runningRef = useRef(false);

  const refresh = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e.message);
    } finally {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled]);

  return { data, error, refresh };
}
