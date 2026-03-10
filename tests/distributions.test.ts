import {
  sampleDistribution,
  distributionMean,
  computeStats,
  formatNum,
  type DistributionInfo,
} from '../src/client/datagrid/distributions';

describe('distributions', () => {
  const N = 10000;

  function sampleMany(dist: DistributionInfo, n = N): number[] {
    return Array.from({ length: n }, () => sampleDistribution(dist));
  }

  describe('sampleDistribution', () => {
    it('normal: samples cluster around mean with correct spread', () => {
      const samples = sampleMany({ type: 'normal', params: [100, 10] });
      const stats = computeStats(samples);
      expect(stats.mean).toBeCloseTo(100, 0);
      expect(stats.stdev).toBeCloseTo(10, 0);
    });

    it('uniform: samples are between min and max', () => {
      const samples = sampleMany({ type: 'uniform', params: [5, 15] });
      const stats = computeStats(samples);
      expect(stats.min).toBeGreaterThanOrEqual(5);
      expect(stats.max).toBeLessThanOrEqual(15);
      expect(stats.mean).toBeCloseTo(10, 0);
    });

    it('triangular: mean is (min+mode+max)/3', () => {
      const samples = sampleMany({ type: 'triangular', params: [0, 5, 10] });
      const stats = computeStats(samples);
      expect(stats.mean).toBeCloseTo(5, 0);
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeLessThanOrEqual(10);
    });

    it('pert: mean is (min+4*mode+max)/6', () => {
      const samples = sampleMany({ type: 'pert', params: [10, 20, 30] });
      const stats = computeStats(samples);
      expect(stats.mean).toBeCloseTo(20, 0);
      expect(stats.min).toBeGreaterThanOrEqual(10);
      expect(stats.max).toBeLessThanOrEqual(30);
    });

    it('lognormal: mean is exp(mu + sigma^2/2)', () => {
      const samples = sampleMany({ type: 'lognormal', params: [0, 0.5] });
      const stats = computeStats(samples);
      const expectedMean = Math.exp(0 + 0.25 / 2);
      expect(stats.mean).toBeCloseTo(expectedMean, 0);
      expect(stats.min).toBeGreaterThan(0);
    });
  });

  describe('distributionMean', () => {
    it('normal', () => expect(distributionMean({ type: 'normal', params: [50, 10] })).toBe(50));
    it('uniform', () => expect(distributionMean({ type: 'uniform', params: [0, 100] })).toBe(50));
    it('triangular', () => expect(distributionMean({ type: 'triangular', params: [0, 30, 60] })).toBe(30));
    it('pert', () => expect(distributionMean({ type: 'pert', params: [10, 20, 30] })).toBe(20));
    it('lognormal', () => expect(distributionMean({ type: 'lognormal', params: [0, 1] })).toBeCloseTo(Math.exp(0.5), 5));
  });

  describe('computeStats', () => {
    it('computes correct percentiles for uniform data', () => {
      const samples = Array.from({ length: 1000 }, (_, i) => i);
      const stats = computeStats(samples);
      expect(stats.mean).toBeCloseTo(499.5, 0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(999);
      expect(stats.p50).toBeCloseTo(499.5, 0);
      expect(stats.p5).toBeCloseTo(50, 0);
      expect(stats.p95).toBeCloseTo(949, 0);
    });

    it('produces a 20-bin histogram', () => {
      const samples = sampleMany({ type: 'normal', params: [0, 1] });
      const stats = computeStats(samples);
      expect(stats.histogram).toHaveLength(20);
      // Peak should be near the middle (bins 9-11 for normal distribution)
      const peakBin = stats.histogram.indexOf(Math.max(...stats.histogram));
      expect(peakBin).toBeGreaterThanOrEqual(7);
      expect(peakBin).toBeLessThanOrEqual(12);
    });

    it('handles empty samples', () => {
      const stats = computeStats([]);
      expect(stats.mean).toBe(0);
      expect(stats.stdev).toBe(0);
    });
  });

  describe('formatNum', () => {
    it('formats integers directly', () => expect(formatNum(42)).toBe('42'));
    it('formats large numbers in exponential', () => expect(formatNum(1e7)).toBe('1.00e+7'));
    it('formats small numbers in exponential', () => expect(formatNum(0.001)).toBe('1.00e-3'));
    it('formats decimals with precision', () => expect(formatNum(3.14159)).toBe('3.142'));
  });
});
