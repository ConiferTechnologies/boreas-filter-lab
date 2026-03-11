'use strict';

// Discrete window size options (hours)
const WINDOW_VALUES = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 24];

/**
 * Moving average filter — causal, time-windowed.
 * Uses an O(n) sliding window for performance.
 * @param {Array<{time:number, value:number}>} data  sorted ascending by time
 * @param {number} windowHrs
 * @returns {number[]}
 */
function movingAverage(data, windowHrs) {
  const windowMs = windowHrs * 3_600_000;
  const half = windowMs / 2;
  const result = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const tStart = data[i].time - half;
    const tEnd   = data[i].time + half;
    let sum = 0, count = 0;
    for (let j = i; j >= 0 && data[j].time >= tStart; j--) {
      sum += data[j].value; count++;
    }
    for (let j = i + 1; j < data.length && data[j].time <= tEnd; j++) {
      sum += data[j].value; count++;
    }
    result[i] = sum / count;
  }
  return result;
}

/**
 * Median filter — causal, time-windowed.
 * @param {Array<{time:number, value:number}>} data  sorted ascending by time
 * @param {number} windowHrs
 * @returns {number[]}
 */
function medianFilter(data, windowHrs) {
  const windowMs = windowHrs * 3_600_000;
  const half = windowMs / 2;
  const result = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const tStart = data[i].time - half;
    const tEnd   = data[i].time + half;
    const vals = [];
    for (let j = i; j >= 0 && data[j].time >= tStart; j--) {
      vals.push(data[j].value);
    }
    for (let j = i + 1; j < data.length && data[j].time <= tEnd; j++) {
      vals.push(data[j].value);
    }
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    result[i] =
      vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
  }
  return result;
}

/**
 * Percentile-clipped average — causal, time-windowed.
 * Trims trimPct% from each tail of the window, then averages the remainder.
 * @param {Array<{time:number, value:number}>} data  sorted ascending by time
 * @param {number} windowHrs
 * @param {number} trimPct  percentage to cut from each end (0–49)
 * @returns {number[]}
 */
function percentileClippedAvg(data, windowHrs, trimPct) {
  const windowMs = windowHrs * 3_600_000;
  const half = windowMs / 2;
  const result = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const tStart = data[i].time - half;
    const tEnd   = data[i].time + half;
    const vals = [];
    for (let j = i; j >= 0 && data[j].time >= tStart; j--) {
      vals.push(data[j].value);
    }
    for (let j = i + 1; j < data.length && data[j].time <= tEnd; j++) {
      vals.push(data[j].value);
    }
    vals.sort((a, b) => a - b);
    const n = vals.length;
    const cut = Math.floor(n * trimPct / 100);
    const trimmed = n - 2 * cut > 0 ? vals.slice(cut, n - cut) : vals;
    result[i] = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }
  return result;
}

/**
 * Exponential moving average — sample-based (alpha is per-sample).
 * @param {Array<{time:number, value:number}>} data
 * @param {number} alpha  0 < alpha < 1
 * @returns {number[]}
 */
function emaFilter(data, alpha) {
  const result = new Array(data.length);
  let ema = data[0].value;
  for (let i = 0; i < data.length; i++) {
    ema = alpha * data[i].value + (1 - alpha) * ema;
    result[i] = ema;
  }
  return result;
}

/**
 * Double EMA (second-order EMA) — applies EMA twice with the same alpha.
 * Smoother than single EMA but with more lag.
 * @param {Array<{time:number, value:number}>} data
 * @param {number} alpha  0 < alpha < 1
 * @returns {number[]}
 */
function doubleEmaFilter(data, alpha) {
  const pass1 = emaFilter(data, alpha);
  const pass1Data = data.map((p, i) => ({ time: p.time, value: pass1[i] }));
  return emaFilter(pass1Data, alpha);
}

/**
 * Outlier Removal + Smoothing — two-stage filter.
 * Stage 1: Median filter (removes outliers/spikes).
 * Stage 2: EMA (smooths the cleaned signal).
 * @param {Array<{time:number, value:number}>} data  sorted ascending by time
 * @param {number} windowHrs  median filter window
 * @param {number} alpha      EMA alpha (per-sample)
 * @returns {number[]}
 */
function medianEmaFilter(data, windowHrs, alpha) {
  const medianPass = medianFilter(data, windowHrs);
  const medianData = data.map((p, i) => ({ time: p.time, value: medianPass[i] }));
  return emaFilter(medianData, alpha);
}

/**
 * Median + Moving Average — two-stage filter.
 * Stage 1: Median filter (centered window, removes outliers/spikes).
 * Stage 2: Moving average (centered window, smooths the cleaned signal).
 * @param {Array<{time:number, value:number}>} data  sorted ascending by time
 * @param {number} medWindowHrs  median filter window
 * @param {number} maWindowHrs   moving average window
 * @returns {number[]}
 */
function medianMAFilter(data, medWindowHrs, maWindowHrs) {
  const medianPass = medianFilter(data, medWindowHrs);
  const medianData = data.map((p, i) => ({ time: p.time, value: medianPass[i] }));
  return movingAverage(medianData, maWindowHrs);
}

// ── Step Response ─────────────────────────────────────────────────────────────

/**
 * Generate synthetic step response for all enabled filters.
 *
 * Signal: 100 samples of 0 → 200 samples of 1, at 15-minute intervals.
 * X-axis returned in hours relative to the step onset.
 *
 * @param {object} filters   state.filters
 * @param {number} settleThreshold  percent (e.g. 5 means settle within 5% of final)
 * @returns {{ times: number[], stepInput: number[], results: object }}
 */
function generateStepResponse(filters, settleThreshold) {
  const PRE  = 100;
  const POST = 200;
  const TOTAL = PRE + POST;
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

  const signal = [];
  for (let i = 0; i < TOTAL; i++) {
    signal.push({ time: i * INTERVAL_MS, value: i < PRE ? 0 : 1 });
  }

  // x-axis in hours relative to step onset
  const times = signal.map((_, i) => ((i - PRE) * 15) / 60);

  const runners = {
    ma:  (d) => movingAverage(d, filters.ma.windowHrs),
    med: (d) => medianFilter(d, filters.med.windowHrs),
    pct: (d) => percentileClippedAvg(d, filters.pct.windowHrs, filters.pct.trimPct),
    ema: (d) => emaFilter(d, filters.ema.alpha),
    ors:  (d) => medianEmaFilter(d, filters.ors.windowHrs, filters.ors.alpha),
    ema2: (d) => doubleEmaFilter(d, filters.ema2.alpha),
    mma:  (d) => medianMAFilter(d, filters.mma.medWindowHrs, filters.mma.maWindowHrs),
  };

  const results = {};
  for (const [key, fn] of Object.entries(runners)) {
    if (!filters[key].enabled) continue;
    const filtered = fn(signal);
    const settleIdx = findSettleIndex(filtered, PRE, settleThreshold);
    results[key] = {
      values:      filtered,
      settleHours: settleIdx !== null ? (settleIdx * 15) / 60 : null,
    };
  }

  return { times, stepInput: signal.map((p) => p.value), results };
}

/**
 * Find the first post-step index where the output is within threshold% of 1
 * AND remains there for all subsequent samples.
 * Returns the number of samples after the step onset, or null if never settled.
 */
function findSettleIndex(filtered, stepIdx, thresholdPct) {
  const level = 1 - thresholdPct / 100;
  for (let i = stepIdx; i < filtered.length; i++) {
    if (filtered[i] >= level) {
      let stays = true;
      for (let j = i + 1; j < filtered.length; j++) {
        if (filtered[j] < level) { stays = false; break; }
      }
      if (stays) return i - stepIdx;
    }
  }
  return null;
}