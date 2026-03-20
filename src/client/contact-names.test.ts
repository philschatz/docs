/**
 * Tests for contact-names.ts in-memory cache.
 */

import { getContactName, setContactName, removeContactName, applyContactNamesFromWorker, setContactNamesDispatch } from './contact-names';

beforeEach(() => {
  // Reset cache
  applyContactNamesFromWorker({});
});

describe('applyContactNamesFromWorker', () => {
  it('replaces the cache', () => {
    applyContactNamesFromWorker({ agent1: 'Alice', agent2: 'Bob' });
    expect(getContactName('agent1')).toBe('Alice');
    expect(getContactName('agent2')).toBe('Bob');
  });

  it('clears previous entries on replace', () => {
    applyContactNamesFromWorker({ agent1: 'Alice' });
    applyContactNamesFromWorker({ agent2: 'Bob' });
    expect(getContactName('agent1')).toBeUndefined();
    expect(getContactName('agent2')).toBe('Bob');
  });
});

describe('getContactName', () => {
  it('returns undefined for unknown agent', () => {
    expect(getContactName('unknown')).toBeUndefined();
  });
});

describe('setContactName', () => {
  it('updates cache optimistically and dispatches', () => {
    const dispatch = jest.fn();
    setContactNamesDispatch(dispatch);

    setContactName('agent1', 'Alice');
    expect(getContactName('agent1')).toBe('Alice');
    expect(dispatch).toHaveBeenCalledWith('set-contact-name', 'agent1', 'Alice');
  });

  it('trims whitespace', () => {
    setContactName('agent1', '  Alice  ');
    expect(getContactName('agent1')).toBe('Alice');
  });

  it('removes name when set to empty string', () => {
    const dispatch = jest.fn();
    setContactNamesDispatch(dispatch);

    setContactName('agent1', 'Alice');
    dispatch.mockClear();

    setContactName('agent1', '  ');
    expect(getContactName('agent1')).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith('remove-contact-name', 'agent1');
  });
});

describe('removeContactName', () => {
  it('removes from cache and dispatches', () => {
    const dispatch = jest.fn();
    setContactNamesDispatch(dispatch);

    applyContactNamesFromWorker({ agent1: 'Alice' });
    removeContactName('agent1');
    expect(getContactName('agent1')).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith('remove-contact-name', 'agent1');
  });
});
