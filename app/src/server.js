'use strict';

const { createApp, seed, log } = require('./app');

const PORT = Number(process.env.PORT || 8080);
seed();

const app = createApp();
const server = app.listen(PORT, () => {
  log('info', 'server started', { port: PORT });
});

// Graceful shutdown: Kubernetes sends SIGTERM before killing the pod.
function shutdown(signal) {
  log('info', 'shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
