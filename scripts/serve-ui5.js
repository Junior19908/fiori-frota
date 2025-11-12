// Simple static server with UI5 resources proxy to CDN.
// Usage: node scripts/serve-ui5.js [port]
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const corsMiddleware = require('../middleware/cors')();
const osUpdatesMiddleware = require('../middleware/osUpdates')({
  options: {
    configuration: {
      endpoint: '/local/os/updates',
      baseDir: path.join(process.cwd(), 'webapp', 'model', 'localdata', 'os')
    }
  }
});

const app = express();
const port = Number(process.argv[2] || 8888);

const webappDir = path.join(process.cwd(), 'webapp');

app.use(corsMiddleware);
app.use(osUpdatesMiddleware);

// Proxy /resources/* to UI5 CDN
app.use('/resources', createProxyMiddleware({
  target: 'https://ui5.sap.com',
  changeOrigin: true,
  pathRewrite: (pathReq) => pathReq,
  logLevel: 'silent'
}));

// Static serving for local app
app.use(express.static(webappDir, { extensions: ['html'] }));

app.listen(port, () => {
  console.log(`[serve-ui5] Listening on http://localhost:${port}`);
});
