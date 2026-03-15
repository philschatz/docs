/**
 * `deepAssign` is injected by the worker's `new Function()` scope in `updateDoc` callbacks.
 * It must NOT be imported in files that use it inside updateDoc arrow functions —
 * imports get minified and break the fn.toString() serialization pattern.
 */
declare function deepAssign(target: any, source: any): void;
