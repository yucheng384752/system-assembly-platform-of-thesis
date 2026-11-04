// Test-only loader: run the same TS API in isolated workers without a bundler subprocess.
const ts = require('typescript');
const { readFileSync } = require('node:fs');
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
require('./concurrent-worker.ts');
