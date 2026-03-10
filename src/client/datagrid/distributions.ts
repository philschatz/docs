/**
 * Probability distribution types, sampling, and statistics.
 *
 * Used by the Monte Carlo engine to propagate uncertainty through formulas.
 */

export interface DistributionInfo {
  type: string;
  params: number[];
}

// --- Random sampling ---

/** Box-Muller transform: two uniform → one standard normal. */
function randNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Gamma distribution via Marsaglia & Tsang's method. */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = randNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta distribution via ratio of gammas. */
function sampleBetaDist(a: number, b: number): number {
  const ga = sampleGamma(a);
  const gb = sampleGamma(b);
  return ga / (ga + gb);
}

/** Draw one sample from a distribution. */
export function sampleDistribution(dist: DistributionInfo): number {
  switch (dist.type) {
    case 'normal': {
      const [mean, stdev] = dist.params;
      return mean + stdev * randNormal();
    }
    case 'uniform': {
      const [min, max] = dist.params;
      return min + Math.random() * (max - min);
    }
    case 'triangular': {
      const [min, mode, max] = dist.params;
      const u = Math.random();
      const fc = (mode - min) / (max - min);
      return u < fc
        ? min + Math.sqrt(u * (max - min) * (mode - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
    case 'pert': {
      const [min, mode, max] = dist.params;
      const range = max - min;
      if (range <= 0) return mode;
      const mu = (min + 4 * mode + max) / 6;
      const a = 1 + 4 * (mu - min) / range;
      const b = 1 + 4 * (max - mu) / range;
      return min + sampleBetaDist(a, b) * range;
    }
    case 'lognormal': {
      const [mu, sigma] = dist.params;
      return Math.exp(mu + sigma * randNormal());
    }
    default:
      return dist.params[0] ?? 0;
  }
}

/** Analytical mean of a distribution. */
export function distributionMean(dist: DistributionInfo): number {
  switch (dist.type) {
    case 'normal': return dist.params[0];
    case 'uniform': return (dist.params[0] + dist.params[1]) / 2;
    case 'triangular': return (dist.params[0] + dist.params[1] + dist.params[2]) / 3;
    case 'pert': return (dist.params[0] + 4 * dist.params[1] + dist.params[2]) / 6;
    case 'lognormal': return Math.exp(dist.params[0] + dist.params[1] ** 2 / 2);
    default: return dist.params[0] ?? 0;
  }
}

// --- Statistics ---

export interface DistributionStats {
  mean: number;
  stdev: number;
  min: number;
  max: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  histogram: number[];
}

/** Compute summary statistics from an array of samples. */
export function computeStats(samples: number[]): DistributionStats {
  const n = samples.length;
  if (n === 0) return { mean: 0, stdev: 0, min: 0, max: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, histogram: [] };

  const sorted = Float64Array.from(samples).sort();
  const mean = samples.reduce((s, v) => s + v, 0) / n;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  const percentile = (p: number) => {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, n - 1);
    const frac = idx - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  };

  // Build histogram (20 bins)
  const bins = 20;
  const minVal = sorted[0];
  const maxVal = sorted[n - 1];
  const histogram = new Array(bins).fill(0);
  const range = maxVal - minVal;
  if (range > 0) {
    for (let i = 0; i < n; i++) {
      const bin = Math.min(Math.floor(((sorted[i] - minVal) / range) * bins), bins - 1);
      histogram[bin]++;
    }
    const maxBin = Math.max(...histogram);
    if (maxBin > 0) {
      for (let i = 0; i < bins; i++) histogram[i] /= maxBin; // normalize to 0..1
    }
  } else {
    histogram[0] = 1;
  }

  return {
    mean,
    stdev: Math.sqrt(variance),
    min: minVal,
    max: maxVal,
    p5: percentile(5),
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
    p95: percentile(95),
    histogram,
  };
}

/** Format a number compactly for display. */
export function formatNum(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e6) return String(v);
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
  return v.toPrecision(4).replace(/\.?0+$/, '');
}
