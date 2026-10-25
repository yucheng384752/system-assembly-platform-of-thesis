import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prefixes, repository } from '../../preview/assemble.mjs';

// D128: every real route of every kit is covered by exactly one declared entry point (or by an explicit built-in rule),
// and no entry point names a route that does not exist. A new route that is not declared fails here instead of silently
// becoming "admin only" at runtime.
const kits = path.join(repository, 'kits');
const builtinRoles = ['admin', 'manager', 'operator', 'audit'];
// Routes of entry-permission-kit itself that are handled by fixed rules in the middleware and routers, not by entry points.
const fixedRules = new Set([
  'POST /api/auth/login', 'GET /api/auth/me', 'PATCH /api/auth/me', 'POST /api/auth/change-password',
  'GET /api/entry-points', 'GET /api/entry-points/me',
  'GET /api/roles', 'POST /api/roles', 'PATCH /api/roles/{role_id}', 'DELETE /api/roles/{role_id}', 'PUT /api/roles/{role_id}/entry-points',
  'PUT /api/users/{user_id}/entry-point-overrides',
]);
// Public exceptions (no user token). Kept in sync with PUBLIC in entry_permission/directory.py by the test below.
const publicRoutes = new Set(['POST /api/mod/subscriptions/webhook']);

/** @param {string} p */
const normalize = p => p.replace(/\{([A-Za-z_][A-Za-z0-9_]*):path\}/g, '{$1}');

async function realRoutes() {
  /** @type {Map<string, string>} */
  const routes = new Map();
  for (const kit of (await readdir(kits, { withFileTypes: true })).filter(d => d.isDirectory())) {
    const api = path.join(kits, kit.name, 'src/backend/app/api');
    /** @type {string[]} */
    let names = [];
    try { names = await readdir(api); } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
    for (const name of names.filter(n => /^routes_.*\.py$/.test(n))) {
      const stem = name.slice(0, -3);
      const source = (await readFile(path.join(api, name), 'utf8')).replace(/^﻿/, '');
      const own = /APIRouter\([^)]*?prefix\s*=\s*["']([^"']*)["']/.exec(source)?.[1] ?? '';
      const registered = prefixes.get(stem);
      assert.notEqual(registered, undefined, `${stem} has no registration rule`);
      for (const m of source.matchAll(/@router\.(get|post|put|patch|delete)\(\s*["']([^"']*)["']/g)) {
        const key = `${m[1].toUpperCase()} ${normalize(`${registered}${own}${m[2]}`)}`;
        assert.ok(!routes.has(key), `duplicate real route ${key}`);
        routes.set(key, kit.name);
      }
    }
  }
  return routes;
}

async function declared() {
  /** @type {Map<string, string>} */
  const covered = new Map();
  /** @type {Map<string, {kit: string, entry: any}>} */
  const entries = new Map();
  for (const kit of (await readdir(kits, { withFileTypes: true })).filter(d => d.isDirectory())) {
    let contract;
    try { contract = JSON.parse((await readFile(path.join(kits, kit.name, 'kit.contract.json'), 'utf8')).replace(/^﻿/, '')); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') continue; throw error; }
    for (const entry of contract.entryPoints ?? []) {
      assert.ok(!entries.has(entry.key), `duplicate entry point key ${entry.key}`);
      entries.set(entry.key, { kit: kit.name, entry });
      for (const route of entry.routes) {
        const key = `${route.method} ${route.path}`;
        assert.ok(!covered.has(key), `${key} is declared by both ${covered.get(key)} and ${entry.key}`);
        covered.set(key, entry.key);
      }
    }
  }
  return { covered, entries };
}

test('every real route is covered by exactly one entry point, a fixed rule or a public exception', async () => {
  const real = await realRoutes();
  const { covered } = await declared();
  const missing = [...real.keys()].filter(k => !covered.has(k) && !fixedRules.has(k) && !publicRoutes.has(k));
  assert.deepEqual(missing, [], `routes with no entry point: ${missing.join('; ')}`);
  const phantom = [...covered.keys()].filter(k => !real.has(k));
  assert.deepEqual(phantom, [], `entry points naming routes that do not exist: ${phantom.join('; ')}`);
  const overlap = [...covered.keys()].filter(k => fixedRules.has(k) || publicRoutes.has(k));
  assert.deepEqual(overlap, [], `routes both declared and built in: ${overlap.join('; ')}`);
  for (const rule of [...fixedRules, ...publicRoutes]) assert.ok(real.has(rule), `built-in rule names a route that does not exist: ${rule}`);
});

test('entry point declarations are well formed and never let the readonly role write', async () => {
  const { entries } = await declared();
  assert.ok(entries.size >= 22, `expected the 22 declared entry points, found ${entries.size}`);
  for (const [key, { entry }] of entries) {
    assert.match(key, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    assert.ok(['read', 'write'].includes(entry.access), key);
    assert.ok(entry.defaultRoles.length > 0, `${key} has no default role`);
    assert.equal(new Set(entry.defaultRoles).size, entry.defaultRoles.length, `${key} repeats a role`);
    for (const role of entry.defaultRoles) assert.ok(builtinRoles.includes(role), `${key}: ${role} is not a builtin role`);
    if (entry.access === 'write') assert.ok(!entry.defaultRoles.includes('audit'), `${key}: the readonly role must not be a write default`);
    if (entry.access === 'read') for (const route of entry.routes) {
      // The generic kit proxy only runs read-only database capabilities (checked in D128); no other read entry may use a mutating verb.
      assert.ok(route.method === 'GET' || key === 'platform.kit_call', `${key}: read entry uses ${route.method}`);
    }
    assert.ok(entry.routes.length > 0, key);
  }
});

test('the webhook public exception matches the fixed list in the middleware directory', async () => {
  const source = await readFile(path.join(kits, 'entry-permission-kit/src/backend/app/entry_permission/directory.py'), 'utf8');
  const pub = /PUBLIC = \{([^}]*)\}/.exec(source)?.[1] ?? '';
  for (const route of publicRoutes) {
    const [method, route_] = route.split(' ');
    assert.ok(pub.includes(`"${route_}": "${method}"`), `${route} is not in PUBLIC`);
  }
});
