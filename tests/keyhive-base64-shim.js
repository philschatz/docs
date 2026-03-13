/**
 * CJS shim for @keyhive/keyhive/keyhive_wasm.base64.js in Jest.
 *
 * The real file is ESM (`export const wasmBase64 = ...`).
 * Jest runs in CJS mode and can't parse it, so this shim
 * reads the raw .wasm file and re-exports it as a base64 string.
 */
const fs = require('fs');
const path = require('path');

const wasmPath = path.join(__dirname, '..', 'node_modules', '@keyhive', 'keyhive', 'pkg-slim', 'keyhive_wasm_bg.wasm');
const wasmBytes = fs.readFileSync(wasmPath);
module.exports.wasmBase64 = wasmBytes.toString('base64');
