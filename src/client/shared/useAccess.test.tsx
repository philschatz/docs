import { renderHook, act, waitFor } from '@testing-library/preact';

let mockGetMyAccess: jest.Mock;

jest.mock('./keyhive-api', () => ({
  getMyAccess: (...args: any[]) => mockGetMyAccess(...args),
}));

import { useAccess } from './useAccess';

beforeEach(() => {
  mockGetMyAccess = jest.fn(() => Promise.resolve(null));
});

describe('useAccess', () => {
  it('returns canEdit: true and loaded: true when no khDocId (unshared doc)', () => {
    const { result } = renderHook(() => useAccess(undefined));
    expect(result.current).toEqual({ access: null, canEdit: true, loaded: true });
    expect(mockGetMyAccess).not.toHaveBeenCalled();
  });

  it('returns canEdit: true when access is admin', async () => {
    mockGetMyAccess.mockResolvedValue('Admin');
    const { result } = renderHook(() => useAccess('kh-doc-1'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ access: 'admin', canEdit: true, loaded: true });
  });

  it('returns canEdit: true when access is write', async () => {
    mockGetMyAccess.mockResolvedValue('Write');
    const { result } = renderHook(() => useAccess('kh-doc-1'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ access: 'write', canEdit: true, loaded: true });
  });

  it('returns canEdit: false when access is read', async () => {
    mockGetMyAccess.mockResolvedValue('Read');
    const { result } = renderHook(() => useAccess('kh-doc-1'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ access: 'read', canEdit: false, loaded: true });
  });

  it('returns canEdit: false and access: null when fetch returns null (no access)', async () => {
    mockGetMyAccess.mockResolvedValue(null);
    const { result } = renderHook(() => useAccess('kh-doc-1'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ access: null, canEdit: false, loaded: true });
  });

  it('loaded starts false, becomes true after fetch resolves', async () => {
    let resolve!: (v: string) => void;
    mockGetMyAccess.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useAccess('kh-doc-1'));

    expect(result.current.loaded).toBe(false);
    expect(result.current.canEdit).toBe(false);

    await act(async () => { resolve('Write'); });
    expect(result.current.loaded).toBe(true);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.access).toBe('write');
  });

  it('returns canEdit: false when fetch rejects', async () => {
    mockGetMyAccess.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useAccess('kh-doc-1'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ access: null, canEdit: false, loaded: true });
  });
});
