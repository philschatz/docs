import {
  populateDocRepoMap,
  setDocRepo,
  getDocRepo,
  clearDocRepoMap,
  repoFor,
  findInRepos,
} from './repo-routing';

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

// --- Mock repo helpers ---

/** Create a mock handle whose whenReady() resolves only when makeReady() is called. */
function mockHandle() {
  let resolve: (() => void) | null = null;
  let ready = false;
  return {
    whenReady: () => ready ? Promise.resolve() : new Promise<void>(r => { resolve = r; }),
    makeReady: () => { ready = true; resolve?.(); },
    isReady: () => ready,
  };
}

function mockRepo(handle: ReturnType<typeof mockHandle>) {
  return { find: jest.fn().mockResolvedValue(handle) };
}

describe('findInRepos', () => {
  it('resolves from the secure repo when it becomes ready first (shared doc scenario)', async () => {
    // Simulates: Bob opens a shared secure doc URL. His local doc list has no
    // entry, and keyhive hasn't synced yet, so the worker doesn't know which
    // repo owns the doc. findInRepos tries both repos; the secure relay
    // delivers the doc first.
    const secureHandle = mockHandle();
    const insecureHandle = mockHandle();
    const secure = mockRepo(secureHandle);
    const insecure = mockRepo(insecureHandle);

    const promise = findInRepos('shared-doc', secure, insecure);

    // Only the secure repo delivers the doc
    secureHandle.makeReady();

    const result = await promise;
    expect(result.mode).toBe('secure');
    expect(result.handle).toBe(secureHandle);
    expect(getDocRepo('shared-doc')).toBe('secure');
  });

  it('resolves from the insecure repo when it becomes ready first', async () => {
    const secureHandle = mockHandle();
    const insecureHandle = mockHandle();
    const secure = mockRepo(secureHandle);
    const insecure = mockRepo(insecureHandle);

    const promise = findInRepos('public-doc', secure, insecure);

    // Only the insecure repo delivers the doc
    insecureHandle.makeReady();

    const result = await promise;
    expect(result.mode).toBe('insecure');
    expect(result.handle).toBe(insecureHandle);
    expect(getDocRepo('public-doc')).toBe('insecure');
  });

  it('works with only one repo available', async () => {
    const handle = mockHandle();
    const secure = mockRepo(handle);
    handle.makeReady();

    const result = await findInRepos('doc', secure, null);
    expect(result.mode).toBe('secure');
    expect(getDocRepo('doc')).toBe('secure');
  });

  it('throws when no repos are available', async () => {
    await expect(findInRepos('doc', null, null)).rejects.toThrow('No repo available');
  });

  // Demonstrates the original bug: repoFor defaults to insecure for unknown
  // docs, so the handle is created in the wrong repo and never becomes ready.
  it('BUG DEMO: repoFor defaults to insecure for unknown docs, wrong repo never becomes ready', async () => {
    const secureHandle = mockHandle();
    const insecureHandle = mockHandle();
    const secure = mockRepo(secureHandle);
    const insecure = mockRepo(insecureHandle);

    // This is the old behavior: repoFor picks insecure for unknown docs
    const wrongRepo = repoFor('shared-doc', secure, insecure);
    expect(wrongRepo).toBe(insecure); // picks insecure — wrong!

    const wrongHandle = await wrongRepo.find('shared-doc');

    // The secure relay would deliver the doc, but we're looking in the wrong repo
    secureHandle.makeReady();

    // The wrong handle is never ready — Bob is stuck on "Finding document"
    expect(wrongHandle.isReady()).toBe(false);
  });
});
