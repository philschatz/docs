/**
 * CJS shim for @keyhive/keyhive/slim in Jest.
 *
 * keyhive_wasm.js uses `import.meta.url` which Jest (CJS mode) can't parse.
 * This shim loads the WASM binary from disk, initializes it via initSync,
 * and re-exports all keyhive classes/functions.
 */

const fs = require('fs');
const path = require('path');

// Load the raw WASM binary
const wasmPath = path.join(__dirname, '..', 'node_modules', '@keyhive', 'keyhive', 'pkg-slim', 'keyhive_wasm_bg.wasm');
const wasmBytes = fs.readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);

// keyhive_wasm.js can't be require()'d (ESM + import.meta), so we use the
// base64 shim's approach: build a Module from raw bytes, then call initSync.
// But we need the JS glue code... We'll eval a patched version.
const jsPath = path.join(__dirname, '..', 'node_modules', '@keyhive', 'keyhive', 'pkg-slim', 'keyhive_wasm.js');
let jsSource = fs.readFileSync(jsPath, 'utf8');

// Patch out `import.meta.url` — replace the line that uses it with a no-op
// since we call initSync (not the async init) and never hit that code path.
jsSource = jsSource.replace(
  /module_or_path = new URL\('keyhive_wasm_bg\.wasm', import\.meta\.url\)/,
  "module_or_path = undefined /* patched for Jest */"
);

// Convert ESM to something evaluable in CJS context
// Replace `export class` with just `class`, etc.
jsSource = jsSource.replace(/^export class /gm, 'class ');
jsSource = jsSource.replace(/^export function /gm, 'function ');
jsSource = jsSource.replace(/^export \{ .* \};?$/gm, '');
jsSource = jsSource.replace(/^export let /gm, 'let ');
jsSource = jsSource.replace(/^export const /gm, 'const ');

// Wrap in a function to capture all declarations, then return them
const fn = new Function('WebAssembly', 'module', 'exports', 'require', `
  ${jsSource}

  // Call initSync with our pre-compiled module
  initSync({ module: arguments[4] });

  // Export everything
  Object.assign(exports, {
    Access, Agent, Archive, ChangeId, CiphertextStore, ContactCard,
    Document, DocumentId, Encrypted, EncryptedContentWithUpdate,
    Group, GroupId, Identifier, Individual, IndividualId, Keyhive,
    Membered, Membership, Peer, ShareKey, Signed, SignedCgkaOperation,
    SignedDelegation, SignedInvocation, SignedRevocation, Signer, Stats,
    Summary, initSync, setPanicHook,
  });
`);

fn(WebAssembly, module, module.exports, require, wasmModule);

// Also export initFromBase64Wasm as a no-op (already initialized)
module.exports.initFromBase64Wasm = function() {};
