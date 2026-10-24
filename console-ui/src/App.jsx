import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate, useRouteError } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { TOKEN } from './api.js';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Whitelist from './pages/Whitelist.jsx';
import Sessions from './pages/Sessions.jsx';
import Persona from './pages/Persona.jsx';
import Logs from './pages/Logs.jsx';
import TokenGate from './components/TokenGate.jsx';

/** 路由级错误边界：任何页面抛错都能看到友好页面而不是白屏。 */
function ErrorBoundary() {
  const error = useRouteError();
  return (
    <Box
      className="fade-in"
      sx={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        textAlign: 'center',
        p: 3,
      }}
    >
      <Box sx={{ fontSize: 44 }}>😵</Box>
      <Box sx={{ fontSize: 18, fontWeight: 700 }}>页面出错了</Box>
      <Box className="mono" sx={{ fontSize: 13, color: 'text.secondary', maxWidth: 560, wordBreak: 'break-all' }}>
        {error?.message ?? String(error)}
      </Box>
      <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => window.location.reload()}>
        重新加载
      </Button>
    </Box>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: TOKEN ? <Layout /> : <TokenGate />,
    errorElement: <ErrorBoundary />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'whitelist', element: <Whitelist /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'persona', element: <Persona /> },
      { path: 'logs', element: <Logs /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
