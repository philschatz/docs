import {
  populateDocRepoMap,
  setDocRepo,
  getDocRepo,
  clearDocRepoMap,
  repoFor,
} from '../src/client/repo-routing';

beforeEach(() => {
  clearDocRepoMap();
});

describe('populateDocRepoMap', () => {
  it('maps encrypted docs to secure and unencrypted to insecure', () => {
    populateDocRepoMap([
      { id: 'doc-a', encrypted: true },
      { id: 'doc-b', encrypted: false },
      { id: 'doc-c' }, // undefined encrypted
    ]);
    expect(getDocRepo('doc-a')).toBe('secure');
    expect(getDocRepo('doc-b')).toBe('insecure');
    expect(getDocRepo('doc-c')).toBe('insecure');
  });

  it('handles empty doc list', () => {
    populateDocRepoMap([]);
    expect(getDocRepo('anything')).toBeUndefined();
  });
});

describe('setDocRepo / getDocRepo', () => {
  it('records and retrieves doc repo assignment', () => {
    setDocRepo('doc-1', 'secure');
    setDocRepo('doc-2', 'insecure');
    expect(getDocRepo('doc-1')).toBe('secure');
    expect(getDocRepo('doc-2')).toBe('insecure');
  });

  it('returns undefined for unknown docs', () => {
    expect(getDocRepo('unknown')).toBeUndefined();
  });

  it('overwrites previous assignment', () => {
    setDocRepo('doc-1', 'secure');
    setDocRepo('doc-1', 'insecure');
    expect(getDocRepo('doc-1')).toBe('insecure');
  });
});

describe('repoFor', () => {
  const secureRepo = { name: 'secure' };
  const insecureRepo = { name: 'insecure' };

  it('returns secure repo for encrypted docs', () => {
    setDocRepo('doc-enc', 'secure');
    expect(repoFor('doc-enc', secureRepo, insecureRepo)).toBe(secureRepo);
  });

  it('returns insecure repo for unencrypted docs', () => {
    setDocRepo('doc-plain', 'insecure');
    expect(repoFor('doc-plain', secureRepo, insecureRepo)).toBe(insecureRepo);
  });

  it('falls back to insecure repo for unknown docs', () => {
    expect(repoFor('unknown', secureRepo, insecureRepo)).toBe(insecureRepo);
  });

  it('falls back to secure repo when insecure is null', () => {
    expect(repoFor('unknown', secureRepo, null)).toBe(secureRepo);
  });

  it('falls back to insecure repo when secure is null', () => {
    setDocRepo('doc-enc', 'secure');
    // secure repo not available — falls back to insecure
    expect(repoFor('doc-enc', null, insecureRepo)).toBe(insecureRepo);
  });

  it('throws when both repos are null', () => {
    expect(() => repoFor('doc', null, null)).toThrow('No repo available');
  });

  it('returns correct repo after populateDocRepoMap', () => {
    populateDocRepoMap([
      { id: 'a', encrypted: true },
      { id: 'b', encrypted: false },
    ]);
    expect(repoFor('a', secureRepo, insecureRepo)).toBe(secureRepo);
    expect(repoFor('b', secureRepo, insecureRepo)).toBe(insecureRepo);
  });

  it('setDocRepo corrects routing for docs added after init', () => {
    populateDocRepoMap([]);
    // Unknown doc falls back to insecure
    expect(repoFor('late-doc', secureRepo, insecureRepo)).toBe(insecureRepo);
    // subscribe-query handler would call setDocRepo with encrypted hint
    setDocRepo('late-doc', 'secure');
    expect(repoFor('late-doc', secureRepo, insecureRepo)).toBe(secureRepo);
  });

  it('respects setDocRepo override after populate', () => {
    populateDocRepoMap([{ id: 'a', encrypted: true }]);
    expect(repoFor('a', secureRepo, insecureRepo)).toBe(secureRepo);
    setDocRepo('a', 'insecure');
    expect(repoFor('a', secureRepo, insecureRepo)).toBe(insecureRepo);
  });
});
