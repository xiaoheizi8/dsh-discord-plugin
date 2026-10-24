import { createTheme } from '@mui/material/styles';

/** DSH Console 暗色主题：Discord 品牌色 + 深空底色。 */
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#5865f2' },
    success: { main: '#3ba55d' },
    warning: { main: '#faa61a' },
    error: { main: '#ed4245' },
    info: { main: '#00a8fc' },
    background: { default: '#0f1117', paper: '#161a23' },
    divider: '#242a3a',
    text: { primary: '#e6e9f0', secondary: '#8b93a7' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid #242a3a',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
});

export default theme;
