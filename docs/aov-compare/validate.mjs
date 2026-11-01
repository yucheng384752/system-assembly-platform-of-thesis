import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
const checkSchema = ajv.compile(readJson('../../schemas/kit-workflow.schema.json'));

function validateWorkflow(workflow) {
  if (!checkSchema(workflow)) {
    throw new Error(`schema: ${ajv.errorsText(checkSchema.errors, { separator: '; ' })}`);
  }
  const outgoing = new Map();
  const indegree = new Map();
  for (const { id } of workflow.nodes) {
    if (outgoing.has(id)) throw new Error(`duplicate node id: ${id}`);
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const { from, to } of workflow.edges) {
    if (!outgoing.has(from) || !outgoing.has(to)) {
      throw new Error(`unknown node in edge: ${from} -> ${to}`);
    }
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const ready = [...indegree.keys()].filter((id) => indegree.get(id) === 0);
  for (let index = 0; index < ready.length; index++) {
    for (const next of outgoing.get(ready[index])) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (ready.length !== workflow.nodes.length) throw new Error('cycle detected');
}

function selfCheck() {
  const node = (id) => ({ id, name: id, capabilityIds: [] });
  const valid = {
    format: 'composer-kit-workflow', version: 1, kitId: 'self-check', kitVersion: '1',
    status: 'draft', scope: 'In-memory validator self-check.',
    nodes: [node('a'), node('b'), node('isolated')], edges: [{ from: 'a', to: 'b' }],
  };
  assert.doesNotThrow(() => validateWorkflow(valid));
  assert.throws(() => validateWorkflow({ ...valid, status: 'invalid' }), /schema:/);
  assert.throws(() => validateWorkflow({ ...valid, nodes: [...valid.nodes, node('a')] }), /duplicate node id/);
  assert.throws(() => validateWorkflow({ ...valid, edges: [{ from: 'missing', to: 'a' }] }), /unknown node/);
  assert.throws(() => validateWorkflow({ ...valid, edges: [{ from: 'a', to: 'missing' }] }), /unknown node/);
  assert.throws(() => validateWorkflow({ ...valid, edges: [{ from: 'a', to: 'a' }] }), /cycle detected/);
  assert.throws(() => validateWorkflow({
    ...valid, nodes: [...valid.nodes, node('x'), node('y')],
    edges: [...valid.edges, { from: 'x', to: 'y' }, { from: 'y', to: 'x' }],
  }), /cycle detected/);
  assert.throws(() => validateWorkflow({ ...valid, edges: [...valid.edges, ...valid.edges] }), /schema:/);
  console.log('PASS validator self-check: valid DAG, schema, duplicate IDs/edges, missing endpoints, self-loop, disconnected cycle');
}

try {
  selfCheck();
  const registered = new Set(readJson('../../config/registry/analytical-four-kit.json').capabilities.map(({ id }) => id));
  for (const file of ['original.aov.json', 'kit.derived.aov.json']) {
    const workflow = readJson(file);
    validateWorkflow(workflow);
    const capabilities = new Set(workflow.nodes.flatMap((node) => node.capabilityIds));
    if (file === 'original.aov.json') {
      assert.equal(workflow.kitId, 'analytical-four-original');
      assert.equal(workflow.kitVersion, 'f49cfd3');
      assert.equal(workflow.status, 'draft');
      assert.equal(capabilities.size, 0, 'original must not claim API capabilities');
    } else {
      assert.equal(workflow.kitId, 'analytical-four-kit');
      assert.equal(workflow.kitVersion, '0.1.0');
      for (const id of capabilities) assert.ok(registered.has(id), `unregistered capability: ${id}`);
    }
    console.log(`PASS ${file}: schema; unique node IDs; existing edge endpoints; acyclic; ${workflow.nodes.length} nodes; ${workflow.edges.length} edges; ${capabilities.size} capabilities`);
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
}
