/**
 * Monte Carlo simulation engine for probability distributions in the datagrid.
 *
 * After HyperFormula evaluates the sheet (producing mean values for distribution
 * functions), this engine runs N sample iterations to build output distributions
 * for every cell that transitively depends on a distribution source.
 *
 * Architecture:
 * 1. Read the distribution registry (populated by distribution HF functions)
 * 2. Create a temporary HyperFormula instance with the same sheet data
 * 3. For each of N iterations, replace distribution cells with sampled values
 *    and read all cell results
 * 4. Compute statistics (mean, stdev, percentiles, histogram) per cell
 * 5. Return results map keyed by "col:row"
 */
import HyperFormula from 'hyperformula';
import { getDistributionRegistry, clearDistributionRegistry } from './hf-functions';
import { sampleDistribution, computeStats, type DistributionStats } from './distributions';
import { registerCustomFunctions } from './hf-functions';

export interface MCResults {
  /** Stats per cell, keyed by "col:row" */
  cells: Map<string, DistributionStats>;
  /** Set of "col:row" keys that are direct distribution sources */
  sources: Set<string>;
}

const NUM_SAMPLES = 500;

/**
 * Run Monte Carlo simulation on a single sheet.
 *
 * @param sheetsData All sheets as name → 2D array (for building temp HF)
 * @param targetSheetIndex Index of the sheet to simulate
 * @param numSamples Number of MC iterations (default 500)
 */
export function runMonteCarlo(
  sheetsData: Record<string, (string | number | boolean | null)[][]>,
  targetSheetIndex: number = 0,
  numSamples: number = NUM_SAMPLES,
): MCResults {
  const registry = getDistributionRegistry();
  if (registry.size === 0) {
    return { cells: new Map(), sources: new Set() };
  }

  // Collect distribution cells for the target sheet
  const distCells: { col: number; row: number; dist: { type: string; params: number[] } }[] = [];
  const sources = new Set<string>();
  for (const [key, dist] of registry) {
    const parts = key.split(':');
    const sheet = parseInt(parts[0], 10);
    const col = parseInt(parts[1], 10);
    const row = parseInt(parts[2], 10);
    if (sheet === targetSheetIndex) {
      distCells.push({ col, row, dist });
      sources.add(`${col}:${row}`);
    }
  }

  if (distCells.length === 0) {
    return { cells: new Map(), sources: new Set() };
  }

  // Find all non-empty cells in the target sheet to track results
  const sheetNames = Object.keys(sheetsData);
  const targetSheetName = sheetNames[targetSheetIndex];
  if (!targetSheetName) return { cells: new Map(), sources };

  const targetData = sheetsData[targetSheetName];
  const trackedCells: { col: number; row: number; key: string }[] = [];
  for (let r = 0; r < targetData.length; r++) {
    for (let c = 0; c < targetData[r].length; c++) {
      const v = targetData[r][c];
      if (v != null && v !== '') {
        trackedCells.push({ col: c, row: r, key: `${c}:${r}` });
      }
    }
  }

  // Create temporary HF instance
  const tmpHf = HyperFormula.buildFromSheets(sheetsData, { licenseKey: 'gpl-v3' });

  // Collect samples for each tracked cell
  const sampleArrays = new Map<string, number[]>();
  for (const cell of trackedCells) {
    sampleArrays.set(cell.key, []);
  }

  // Run N iterations
  for (let i = 0; i < numSamples; i++) {
    // Replace all distribution cells with sampled values (batched)
    tmpHf.batch(() => {
      for (const dc of distCells) {
        const sampled = sampleDistribution(dc.dist);
        tmpHf.setCellContents({ sheet: targetSheetIndex, col: dc.col, row: dc.row }, [[sampled]]);
      }
    });

    // Read results
    for (const cell of trackedCells) {
      const val = tmpHf.getCellValue({ sheet: targetSheetIndex, col: cell.col, row: cell.row });
      const arr = sampleArrays.get(cell.key)!;
      if (typeof val === 'number' && isFinite(val)) {
        arr.push(val);
      }
    }
  }

  tmpHf.destroy();

  // Compute statistics for cells that have numeric variation
  const results = new Map<string, DistributionStats>();
  for (const [key, samples] of sampleArrays) {
    // Only include cells with enough numeric samples and non-zero variance
    if (samples.length < numSamples * 0.5) continue;
    const stats = computeStats(samples);
    if (stats.stdev > 1e-12 || sources.has(key)) {
      results.set(key, stats);
    }
  }

  return { cells: results, sources };
}

/**
 * Run Monte Carlo asynchronously in chunks to avoid blocking the main thread.
 * Yields between chunks using setTimeout(0).
 */
export function runMonteCarloAsync(
  sheetsData: Record<string, (string | number | boolean | null)[][]>,
  targetSheetIndex: number = 0,
  numSamples: number = NUM_SAMPLES,
): { promise: Promise<MCResults>; cancel: () => void } {
  let cancelled = false;

  const promise = new Promise<MCResults>((resolve) => {
    const registry = getDistributionRegistry();
    if (registry.size === 0) {
      resolve({ cells: new Map(), sources: new Set() });
      return;
    }

    const distCells: { col: number; row: number; dist: { type: string; params: number[] } }[] = [];
    const sources = new Set<string>();
    for (const [key, dist] of registry) {
      const parts = key.split(':');
      const sheet = parseInt(parts[0], 10);
      const col = parseInt(parts[1], 10);
      const row = parseInt(parts[2], 10);
      if (sheet === targetSheetIndex) {
        distCells.push({ col, row, dist });
        sources.add(`${col}:${row}`);
      }
    }

    if (distCells.length === 0) {
      resolve({ cells: new Map(), sources: new Set() });
      return;
    }

    const sheetNames = Object.keys(sheetsData);
    const targetSheetName = sheetNames[targetSheetIndex];
    if (!targetSheetName) {
      resolve({ cells: new Map(), sources });
      return;
    }

    const targetData = sheetsData[targetSheetName];
    const trackedCells: { col: number; row: number; key: string }[] = [];
    for (let r = 0; r < targetData.length; r++) {
      for (let c = 0; c < targetData[r].length; c++) {
        const v = targetData[r][c];
        if (v != null && v !== '') {
          trackedCells.push({ col: c, row: r, key: `${c}:${r}` });
        }
      }
    }

    const tmpHf = HyperFormula.buildFromSheets(sheetsData, { licenseKey: 'gpl-v3' });
    const sampleArrays = new Map<string, number[]>();
    for (const cell of trackedCells) {
      sampleArrays.set(cell.key, []);
    }

    const CHUNK_SIZE = 50;
    let iteration = 0;

    function runChunk() {
      if (cancelled) {
        tmpHf.destroy();
        resolve({ cells: new Map(), sources });
        return;
      }

      const end = Math.min(iteration + CHUNK_SIZE, numSamples);
      for (; iteration < end; iteration++) {
        tmpHf.batch(() => {
          for (const dc of distCells) {
            tmpHf.setCellContents(
              { sheet: targetSheetIndex, col: dc.col, row: dc.row },
              [[sampleDistribution(dc.dist)]],
            );
          }
        });
        for (const cell of trackedCells) {
          const val = tmpHf.getCellValue({ sheet: targetSheetIndex, col: cell.col, row: cell.row });
          if (typeof val === 'number' && isFinite(val)) {
            sampleArrays.get(cell.key)!.push(val);
          }
        }
      }

      if (iteration >= numSamples) {
        tmpHf.destroy();
        const results = new Map<string, DistributionStats>();
        for (const [key, samples] of sampleArrays) {
          if (samples.length < numSamples * 0.5) continue;
          const stats = computeStats(samples);
          if (stats.stdev > 1e-12 || sources.has(key)) {
            results.set(key, stats);
          }
        }
        resolve({ cells: results, sources });
      } else {
        setTimeout(runChunk, 0);
      }
    }

    setTimeout(runChunk, 0);
  });

  return { promise, cancel: () => { cancelled = true; } };
}
