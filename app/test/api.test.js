'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, seed } = require('../src/app');

let server;
let base;

before(() => {
  seed();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

test('liveness and readiness probes return 200', async () => {
  assert.equal((await call('GET', '/health/live')).status, 200);
  const ready = await call('GET', '/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, 'ready');
});

test('seeded tasks are listed', async () => {
  const r = await call('GET', '/api/tasks');
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 3);
});

test('create task validates title', async () => {
  assert.equal((await call('POST', '/api/tasks', {})).status, 400);
  assert.equal((await call('POST', '/api/tasks', { title: '   ' })).status, 400);
  assert.equal((await call('POST', '/api/tasks', { title: 'x'.repeat(201) })).status, 400);
});

test('create, update and delete a task', async () => {
  const created = await call('POST', '/api/tasks', { title: 'Write tests' });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const patched = await call('PATCH', `/api/tasks/${id}`, { done: true });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.done, true);

  assert.equal((await call('DELETE', `/api/tasks/${id}`)).status, 204);
  assert.equal((await call('DELETE', `/api/tasks/${id}`)).status, 404);
});

test('malformed JSON returns 400 without a stack trace', async () => {
  const res = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'malformed JSON');
});

test('metrics endpoint exposes Prometheus counters', async () => {
  await call('GET', '/api/version');
  const res = await fetch(base + '/metrics');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(text, /http_requests_total/);
  assert.match(text, /taskflow_tasks_total/);
});

test('security headers: x-powered-by is removed', async () => {
  const r = await call('GET', '/api/version');
  assert.equal(r.headers.get('x-powered-by'), null);
});
