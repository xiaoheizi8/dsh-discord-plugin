import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { TOKEN } from './api.js';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Whitelist from './pages/Whitelist.jsx';
import Sessions from './pages/Sessions.jsx';
import Persona from './pages/Persona.jsx';
import Logs from './pages/Logs.jsx';
import TokenGate from './components/TokenGate.jsx';

const router = createBrowserRouter([
  {
    path: '/',
    element: TOKEN ? <Layout /> : <TokenGate />,
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
