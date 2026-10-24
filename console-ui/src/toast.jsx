import React, { useEffect, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';

/** 模块级 toast 总线：任何组件 import { toast } 即可发通知。 */
let push = null;
let seq = 0;

export function toast(text, severity = 'success') {
  push?.({ text, severity, key: ++seq });
}

const DURATION = 3800;

export function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    push = (item) => {
      setItems((prev) => [...prev.slice(-2), item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.key !== item.key));
      }, DURATION);
    };
    return () => {
      push = null;
    };
  }, []);

  const close = (key) => setItems((prev) => prev.filter((i) => i.key !== key));

  return (
    <>
      {items.map((it, idx) => (
        <Snackbar
          key={it.key}
          open
          autoHideDuration={DURATION}
          onClose={() => close(it.key)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ bottom: `${24 + idx * 62}px !important` }}
        >
          <Alert
            onClose={() => close(it.key)}
            severity={it.severity}
            variant="filled"
            sx={{ minWidth: 280, boxShadow: 8, alignItems: 'center' }}
          >
            {it.text}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
