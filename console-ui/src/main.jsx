import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App.jsx';
import theme from './theme.js';
import { ToastHost } from './toast.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <ToastHost />
    <App />
  </ThemeProvider>
);
