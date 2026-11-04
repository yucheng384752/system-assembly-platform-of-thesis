import { parentPort, workerData } from 'node:worker_threads';
import { openCaseStore, type SaveVersionInput } from './index';

const data: { path: string; input: SaveVersionInput } = workerData;
const store = openCaseStore(data.path);
parentPort!.once('message', async () => {
  try { parentPort!.postMessage(await store.saveVersion(data.input)); }
  finally { store.close(); parentPort!.close(); }
});
parentPort!.postMessage('ready');
