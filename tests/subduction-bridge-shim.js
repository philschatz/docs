// CJS shim for @automerge/automerge-repo-subduction-bridge (ESM-only package).
const fs = require('fs');
const path = require('path');
const { setSubductionModule } = require('@automerge/automerge-repo');

// Load storage bridge source directly from node_modules
const bridgeDir = path.resolve(__dirname, '..', 'node_modules', '@automerge', 'automerge-repo-subduction-bridge', 'dist');
const storageSrc = fs.readFileSync(path.join(bridgeDir, 'storage.js'), 'utf8');

// Convert ESM to CJS
const storageCjs = storageSrc
  .replace(/export function _setSubductionModuleForStorage/g, 'function _setSubductionModuleForStorage')
  .replace(/export class SubductionStorageBridge/g, 'class SubductionStorageBridge');

const fn = new Function('module', 'exports', 'require', storageCjs + '\nmodule.exports = { SubductionStorageBridge, _setSubductionModuleForStorage };');
const mod = { exports: {} };
fn(mod, mod.exports, require);
const { SubductionStorageBridge, _setSubductionModuleForStorage } = mod.exports;

function initSubductionModule(module) {
  setSubductionModule(module);
  _setSubductionModuleForStorage(module);
}

async function setupSubduction({ subductionModule, signer, storageAdapter }) {
  initSubductionModule(subductionModule);
  const storage = new SubductionStorageBridge(storageAdapter);
  const subduction = await subductionModule.Subduction.hydrate(signer, storage);
  return { subduction, storage };
}

module.exports = {
  SubductionStorageBridge,
  initSubductionModule,
  setupSubduction,
};
