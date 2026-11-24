'use strict';

const express = require('express');
const client = require('prom-client');

const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const APP_ENV = process.env.APP_ENV || 'dev';

// ---------- structured logging (JSON lines, consumed by Fluent Bit -> Loki) ----------
function log(level, msg, extra = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    service: 'taskflow-api',
    version: APP_VERSION,
    env: APP_ENV,
    msg,
    ...extra,
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}

// ---------- Prometheus metrics ----------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

const tasksGauge = new client.Gauge({
  name: 'taskflow_tasks_total',
  help: 'Number of tasks currently stored',
  registers: [register],
});

// ---------- in-memory store (sample data; swap for a database in production) ----------
const tasks = new Map();
let nextId = 1;

function seed() {
  for (const title of ['Set up CI pipeline', 'Write Kubernetes manifests', 'Configure Grafana dashboards']) {
    const id = nextId++;
    tasks.set(id, { id, title, done: false, createdAt: new Date().toISOString() });
  }
  tasksGauge.set(tasks.size);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  // request logging + metrics middleware
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequests.inc(labels);
      httpDuration.observe(labels, seconds);
      log('info', 'request', { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Math.round(seconds * 1000) });
    });
    next();
  });

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  app.get('/health/ready', (_req, res) => {
    res.json({ status: 'ready', version: APP_VERSION, env: APP_ENV });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION, env: APP_ENV }));

  app.get('/api/tasks', (_req, res) => {
    res.json({ items: [...tasks.values()] });
  });

  app.post('/api/tasks', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > 200) {
      return res.status(400).json({ error: 'title is required (1-200 characters)' });
    }
    const id = nextId++;
    const task = { id, title, done: false, createdAt: new Date().toISOString() };
    tasks.set(id, task);
    tasksGauge.set(tasks.size);
    return res.status(201).json(task);
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const task = tasks.get(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'not found' });
    if (typeof req.body?.done === 'boolean') task.done = req.body.done;
    return res.json(task);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!tasks.delete(id)) return res.status(404).json({ error: 'not found' });
    tasksGauge.set(tasks.size);
    return res.status(204).end();
  });

  // JSON error handler: never leak stack traces
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'malformed JSON' });
    }
    log('error', 'unhandled error', { error: err.message });
    return res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp, seed, log, register, tasks };
