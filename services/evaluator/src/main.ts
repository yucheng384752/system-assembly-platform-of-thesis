// Stdio loop: one JSON request per line in, one JSON response per line out. stdout carries only responses; diagnostics go to stderr.
import { MAX_REQUEST_BYTES, respond } from './protocol';

let pending = '';
let skipping = false; // inside a line that already exceeded the limit

function tooLarge() {
  process.stdout.write(JSON.stringify({ id: null, ok: false, error: { code: 'too-large', message: `a request may be at most ${MAX_REQUEST_BYTES} bytes` } }) + '\n');
}

function handle(line: string) {
  if (line.trim()) process.stdout.write(respond(line) + '\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  let rest = chunk;
  for (let at = rest.indexOf('\n'); at >= 0; at = rest.indexOf('\n')) {
    const part = rest.slice(0, at);
    rest = rest.slice(at + 1);
    if (skipping) skipping = false;
    else if (Buffer.byteLength(pending) + Buffer.byteLength(part) > MAX_REQUEST_BYTES) tooLarge();
    else handle(pending + part);
    pending = '';
  }
  if (skipping) return;
  pending += rest;
  if (Buffer.byteLength(pending) > MAX_REQUEST_BYTES) {
    pending = '';
    skipping = true;
    process.stdout.write(JSON.stringify({ id: null, ok: false, error: { code: 'too-large', message: `a request may be at most ${MAX_REQUEST_BYTES} bytes` } }) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
