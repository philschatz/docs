/**
 * Tests for deep-assign.ts.
 * Corner cases: undefined deletion, null handling, nested merging, categories special case.
 */

import { deepAssign } from '../src/shared/deep-assign';

describe('deepAssign', () => {
  it('merges flat properties', () => {
    const target = { a: 1, b: 2 };
    deepAssign(target, { b: 3 });
    expect(target).toEqual({ a: 1, b: 3 });
  });

  it('deletes properties when source value is undefined', () => {
    const target: Record<string, any> = { a: 1, description: 'hello' };
    deepAssign(target, { description: undefined });
    expect(target).toEqual({ a: 1 });
    expect('description' in target).toBe(false);
  });

  it('sets null values', () => {
    const target: Record<string, any> = { a: 1, b: 'hello' };
    deepAssign(target, { b: null });
    expect(target).toEqual({ a: 1, b: null });
  });

  it('does not re-assign null when already null', () => {
    const target: Record<string, any> = { a: null };
    const original = target.a;
    deepAssign(target, { a: null });
    expect(target.a).toBe(original);
  });

  it('recursively merges nested objects', () => {
    const target = { nested: { x: 1, y: 2 } };
    deepAssign(target, { nested: { y: 3 } } as any);
    expect(target).toEqual({ nested: { x: 1, y: 3 } });
  });

  it('does not merge arrays recursively (replaces them)', () => {
    const target = { items: [1, 2, 3] };
    deepAssign(target, { items: [4, 5] } as any);
    expect(target).toEqual({ items: [4, 5] });
  });

  it('merges single-element arrays recursively', () => {
    const target = { arr: [{ a: 1, b: 2 }] };
    deepAssign(target, { arr: [{ b: 3 }] } as any);
    expect(target).toEqual({ arr: [{ a: 1, b: 3 }] });
  });

  it('replaces categories even if both are objects', () => {
    const target = { categories: { work: true } };
    deepAssign(target, { categories: { personal: true } } as any);
    expect(target).toEqual({ categories: { personal: true } });
  });

  it('does not replace categories when identical', () => {
    const cats = { work: true };
    const target = { categories: cats };
    deepAssign(target, { categories: { work: true } } as any);
    // Should still be the same reference since JSON.stringify matches
    expect(target.categories).toBe(cats);
  });

  it('skips assignment when primitive values are identical', () => {
    const target = { a: 5 };
    deepAssign(target, { a: 5 });
    expect(target).toEqual({ a: 5 });
  });
});
