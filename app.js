'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const FILTER_KEYS   = ['ma', 'med', 'pct', 'ema', 'ors', 'ema2', 'mma'];

const FILTER_COLORS = { ma: '#00BFFF', med: '#FF6B00', pct: '#39FF14', ema: '#FF00FF', ors: '#FF4444', ema2: '#9D00FF', mma: '#FFD700' };
const FILTER_NAMES  = { ma: 'Moving Avg', med: 'Median', pct: 'Pct Clipped', ema: 'EMA', ors: 'ORS', ema2: 'Double EMA', mma: 'Median + MA' };

const RAW_WEIGHT_COLOR = '#ffffff';
const RAW_ROL_COLOR    = '#ffffff';

// Shared Plotly visual settings
const PAPER_BG  = '#111126';
const PLOT_BG   = '#0b0b1a';
const GRID_CLR  = '#1a1a38';
const ZERO_CLR  = '#252548';
const TICK_CLR  = '#6868a0';
const FONT_FAM  = 'Segoe UI, system-ui, sans-serif';

const BASE_LAYOUT = {
  paper_bgcolor: PAPER_BG,
  plot_bgcolor:  PLOT_BG,
  font: { color: RAW_WEIGHT_COLOR, family: FONT_FAM, size: 11 },
  legend: {
    bgcolor: 'rgba(17,17,38,0.9)',
    bordercolor: '#252548',
    borderwidth: 1,
    font: { size: 10 },
  },
};

const AXIS = {
  gridcolor:     GRID_CLR,
  zerolinecolor: ZERO_CLR,
  linecolor:     '#252548',
  tickfont:      { size: 10, color: TICK_CLR },
};

// Config for Graph 3 — fully locked, no modebar
const GRAPH3_CFG = {
  responsive:     true,
  displayModeBar: false,
  scrollZoom:     false,
  displaylogo:    false,
};

// Graph 1/2 config — varies by lock state
function graphConfig(locked) {
  return {
    responsive:             true,
    displayModeBar:         !locked,
    displaylogo:            false,
    scrollZoom:             !locked,
    modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
  };
}

// ── Application State ──────────────────────────────────────────────────────

const state = {
  weightData: [],   // [{time: ms, value: number}]
  rolData:    [],   // [{time: ms, value: number}]
  filters: {
    ma:  { enabled: false, windowHrs: 1 },
    med: { enabled: false, windowHrs: 2 },
    pct: { enabled: false, windowHrs: 1, trimPct: 10 },
    ema: { enabled: false, alpha: 0.1 },
    ors:  { enabled: false, windowHrs: 1, alpha: 0.1 },
    ema2: { enabled: false, alpha: 0.1 },
    mma:  { enabled: false, medWindowHrs: 1, maWindowHrs: 2 },
  },
  settleThreshold: 5,
  graphLocked: { g1: true, g2: true }, // default: locked (autoscale, no interaction)
};

// ── Debounce ───────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const debouncedRefreshFiltered = debounce(() => {
  renderGraph2();
  renderGraph3();
}, 120);

// ── Boot ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupUploadZone('weight-drop', 'weight-file', 'weight-info', (data) => {
    state.weightData = data;
    maybeRenderGraphs();
  });

  setupUploadZone('rol-drop', 'rol-file', 'rol-info', (data) => {
    state.rolData = data;
    maybeRenderGraphs();
  });

  setupFilterControls();
  setupSettleThreshold();
  setupGraphLockToggle('g1-unlock', 'g1', 'graph1');
  setupGraphLockToggle('g2-unlock', 'g2', 'graph2');
  renderGraph3(); // show step response immediately with defaults
});

function maybeRenderGraphs() {
  if (state.weightData.length && state.rolData.length) {
    renderGraph1();
    renderGraph2();
  } else if (state.weightData.length || state.rolData.length) {
    // Render whichever graph we can partially show
    renderGraph1();
    renderGraph2();
  }
  renderGraph3();
}

// ── Datadog CSV Upload ─────────────────────────────────────────────────────

function setupUploadZone(dropId, inputId, infoId, onData) {
  const drop  = document.getElementById(dropId);
  const input = document.getElementById(inputId);

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') input.click();
  });

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) parseDatadogCSV(file, drop, infoId, onData);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) parseDatadogCSV(input.files[0], drop, infoId, onData);
  });
}

/**
 * Parse a Datadog CSV export.
 * Expected columns: query, group, time, value  (others ignored)
 */
function parseDatadogCSV(file, dropEl, infoId, onData) {
  Papa.parse(file, {
    header:         true,
    skipEmptyLines: true,
    complete(result) {
      const fields = result.meta.fields || [];
      const timeField  = fields.find((f) => f.trim().toLowerCase() === 'time');
      const valueField = fields.find((f) => f.trim().toLowerCase() === 'value');

      if (!timeField || !valueField) {
        alert(
          `Could not find required columns in "${file.name}".\n` +
          `Expected columns: time, value\n` +
          `Found: ${fields.join(', ')}`
        );
        return;
      }

      const data = result.data
        .map((row) => ({
          time:  new Date(row[timeField]).getTime(),
          value: parseFloat(row[valueField]),
        }))
        .filter((p) => isFinite(p.time) && isFinite(p.value))
        .sort((a, b) => a.time - b.time);

      if (!data.length) {
        alert(`No valid rows found in "${file.name}".`);
        return;
      }

      dropEl.classList.add('loaded');
      showUploadInfo(infoId, file.name, data);
      onData(data);
    },
    error(err) {
      alert(`CSV parse error in "${file.name}": ${err.message}`);
    },
  });
}

function showUploadInfo(infoId, filename, data) {
  const el = document.getElementById(infoId);
  const t0 = new Date(data[0].time);
  const t1 = new Date(data[data.length - 1].time);
  const hrs = ((t1 - t0) / 3_600_000).toFixed(1);
  el.innerHTML =
    `<span class="info-rows">${data.length.toLocaleString()} rows</span>` +
    `<span class="info-range">${fmtDate(t0)} &rarr; ${fmtDate(t1)} &nbsp;(${hrs}&thinsp;h)</span>`;
  el.classList.remove('hidden');
}

function fmtDate(d) {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// ── Filter Controls ────────────────────────────────────────────────────────

function setupFilterControls() {
  bindWindowSlider('ma-win',  'ma-win-val',  2, (v) => { state.filters.ma.windowHrs  = v; debouncedRefreshFiltered(); });
  bindWindowSlider('med-win', 'med-win-val', 3, (v) => { state.filters.med.windowHrs = v; debouncedRefreshFiltered(); });
  bindWindowSlider('pct-win', 'pct-win-val', 2, (v) => { state.filters.pct.windowHrs = v; debouncedRefreshFiltered(); });
  bindWindowSlider('ors-win',     'ors-win-val',     2, (v) => { state.filters.ors.windowHrs     = v; debouncedRefreshFiltered(); });
  bindWindowSlider('mma-med-win', 'mma-med-win-val', 2, (v) => { state.filters.mma.medWindowHrs  = v; debouncedRefreshFiltered(); });
  bindWindowSlider('mma-ma-win',  'mma-ma-win-val',  4, (v) => { state.filters.mma.maWindowHrs   = v; debouncedRefreshFiltered(); });

  const ema2AlphaSl  = document.getElementById('ema2-alpha');
  const ema2AlphaVal = document.getElementById('ema2-alpha-val');
  ema2AlphaSl.addEventListener('input', () => {
    const v = +ema2AlphaSl.value / 100;
    ema2AlphaVal.textContent = v.toFixed(2);
    state.filters.ema2.alpha = v;
    debouncedRefreshFiltered();
  });

  const orsAlphaSl  = document.getElementById('ors-alpha');
  const orsAlphaVal = document.getElementById('ors-alpha-val');
  orsAlphaSl.addEventListener('input', () => {
    const v = +orsAlphaSl.value / 100;
    orsAlphaVal.textContent = v.toFixed(2);
    state.filters.ors.alpha = v;
    debouncedRefreshFiltered();
  });

  const trimSl  = document.getElementById('pct-trim');
  const trimVal = document.getElementById('pct-trim-val');
  trimSl.addEventListener('input', () => {
    const v = +trimSl.value;
    trimVal.textContent = `${v}%`;
    state.filters.pct.trimPct = v;
    debouncedRefreshFiltered();
  });

  const alphaSl  = document.getElementById('ema-alpha');
  const alphaVal = document.getElementById('ema-alpha-val');
  alphaSl.addEventListener('input', () => {
    const v = +alphaSl.value / 100;
    alphaVal.textContent = v.toFixed(2);
    state.filters.ema.alpha = v;
    debouncedRefreshFiltered();
  });

  for (const key of FILTER_KEYS) {
    bindToggle(`${key}-on`, key);
  }

}

function bindWindowSlider(sliderId, valId, defaultIdx, onChange) {
  const sl  = document.getElementById(sliderId);
  const val = document.getElementById(valId);
  sl.value = defaultIdx;
  val.textContent = fmtHours(WINDOW_VALUES[defaultIdx]);
  sl.addEventListener('input', () => {
    const v = WINDOW_VALUES[+sl.value];
    val.textContent = fmtHours(v);
    onChange(v);
  });
}

function bindToggle(checkboxId, filterKey) {
  const cb   = document.getElementById(checkboxId);
  const card = document.getElementById(`ctrl-${filterKey}`);
  // Force checkbox to match JS state, overriding any browser form restoration
  cb.checked = state.filters[filterKey].enabled;
  card.classList.toggle('disabled', !cb.checked);
  cb.addEventListener('change', () => {
    state.filters[filterKey].enabled = cb.checked;
    card.classList.toggle('disabled', !cb.checked);
    debouncedRefreshFiltered();
  });
}

function fmtHours(h) {
  if (h < 1) return `${h * 60} min`;
  return h === 1 ? '1 hr' : `${h} hr`;
}

function setupSettleThreshold() {
  const el = document.getElementById('settle-thresh');
  el.addEventListener('change', () => {
    const v = Math.max(1, Math.min(50, parseInt(el.value, 10) || 5));
    el.value = v;
    state.settleThreshold = v;
    renderGraph3();
  });
}

function setupGraphLockToggle(checkboxId, key, divId) {
  const cb = document.getElementById(checkboxId);
  if (!cb) return;
  cb.addEventListener('change', () => {
    state.graphLocked[key] = !cb.checked; // checked = unlocked
    if (state.graphLocked[key]) {
      // Re-lock: reset to autoscale then re-render
      Plotly.relayout(divId, {
        'xaxis.autorange':  true,
        'yaxis.autorange':  true,
        'yaxis2.autorange': true,
      });
    }
    if (key === 'g1') renderGraph1();
    if (key === 'g2') renderGraph2();
  });
}

// ── Graph Helpers ──────────────────────────────────────────────────────────

/** Build a Plotly subplot layout for Weight (top) + RoL (bottom). */
function subplotLayout(locked = true, extraOpts = {}, height = 500) {
  return {
    ...BASE_LAYOUT,
    height,
    margin: { t: 16, b: 50, l: 75, r: 20 },
    yaxis: {
      ...AXIS,
      domain: [0.53, 1],
      fixedrange: locked,
      title: { text: 'Weight (kg)', font: { size: 11 } },
    },
    yaxis2: {
      ...AXIS,
      domain: [0, 0.47],
      anchor: 'x',
      fixedrange: locked,
      title: { text: 'RoL', font: { size: 11 } },
    },
    xaxis: {
      ...AXIS,
      type: 'date',
      fixedrange: locked,
      title: { text: 'Time (UTC)', font: { size: 11 } },
    },
    ...extraOpts,
  };
}

/** Create a Plotly line trace. */
function traceLine(x, y, name, color, yaxis = 'y', lineExtra = {}) {
  return {
    x, y, name,
    type: 'scatter',
    mode: 'lines',
    yaxis,
    line: { color, width: 1.5, ...lineExtra },
    hovertemplate: `<b>${name}</b><br>%{x}<br>%{y:.5g}<extra></extra>`,
  };
}

function isoTimes(arr) {
  return arr.map((p) => new Date(p.time).toISOString());
}

function values(arr) {
  return arr.map((p) => p.value);
}

// ── Graph 1 — Raw Data ─────────────────────────────────────────────────────

function renderGraph1() {
  const hasWeight = state.weightData.length > 0;
  const hasRol    = state.rolData.length > 0;

  const empty1 = document.getElementById('graph1-empty');

  if (!hasWeight && !hasRol) {
    empty1 && empty1.classList.remove('hidden');
    return;
  }
  empty1 && empty1.classList.add('hidden');

  const traces = [];
  if (hasWeight) {
    traces.push(traceLine(isoTimes(state.weightData), values(state.weightData), 'Weight', RAW_WEIGHT_COLOR, 'y'));
  }
  if (hasRol) {
    traces.push(traceLine(isoTimes(state.rolData), values(state.rolData), 'RoL', RAW_ROL_COLOR, 'y2'));
  }

  Plotly.react('graph1', traces, subplotLayout(state.graphLocked.g1), graphConfig(state.graphLocked.g1));
}

// ── Graph 2 — Filtered Data ────────────────────────────────────────────────

function renderGraph2() {
  const hasWeight = state.weightData.length > 0;
  const hasRol    = state.rolData.length > 0;

  const empty2 = document.getElementById('graph2-empty');

  if (!hasWeight && !hasRol) {
    empty2 && empty2.classList.remove('hidden');
    return;
  }
  empty2 && empty2.classList.add('hidden');

  const traces = [];

  // Top: raw weight
  if (hasWeight) {
    traces.push(traceLine(isoTimes(state.weightData), values(state.weightData), 'Weight', RAW_WEIGHT_COLOR, 'y'));
  }

  // Bottom: raw RoL + filtered series
  if (hasRol) {
    traces.push(traceLine(
      isoTimes(state.rolData), values(state.rolData),
      'RoL (raw)', RAW_ROL_COLOR, 'y2', { dash: 'dot', width: 1 }
    ));

    for (const key of FILTER_KEYS) {
      const f = state.filters[key];
      if (!f.enabled) continue;

      let filtered;
      if (key === 'ma')  filtered = movingAverage(state.rolData, f.windowHrs);
      if (key === 'med') filtered = medianFilter(state.rolData, f.windowHrs);
      if (key === 'pct') filtered = percentileClippedAvg(state.rolData, f.windowHrs, f.trimPct);
      if (key === 'ema') filtered = emaFilter(state.rolData, f.alpha);
      if (key === 'ors')  filtered = medianEmaFilter(state.rolData, f.windowHrs, f.alpha);
      if (key === 'ema2') filtered = doubleEmaFilter(state.rolData, f.alpha);
      if (key === 'mma')  filtered = medianMAFilter(state.rolData, f.medWindowHrs, f.maWindowHrs);

      traces.push(traceLine(
        isoTimes(state.rolData), filtered,
        FILTER_NAMES[key], FILTER_COLORS[key], 'y2'
      ));
    }
  }

  Plotly.react('graph2', traces, subplotLayout(state.graphLocked.g2, { legend: { ...BASE_LAYOUT.legend, x: 0, y: 1 } }, 650), graphConfig(state.graphLocked.g2));
}

// ── Graph 3 — Step Response ────────────────────────────────────────────────

function renderGraph3() {
  const { times, stepInput, results } = generateStepResponse(state.filters, state.settleThreshold);
  const settleLevel = 1 - state.settleThreshold / 100;

  const traces = [
    // Reference step
    {
      x: times, y: stepInput, name: 'Step Input',
      type: 'scatter', mode: 'lines',
      line: { color: '#ffffff', width: 1.5, dash: 'dash' },
      hovertemplate: '<b>Step Input</b><br>%{x:.2f} h<br>%{y}<extra></extra>',
    },
    // Settle threshold line
    {
      x: [times[0], times[times.length - 1]],
      y: [settleLevel, settleLevel],
      name: `Settle (${state.settleThreshold}%)`,
      type: 'scatter', mode: 'lines',
      line: { color: '#ff3333', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
    },
  ];

  const shapes = [];

  for (const key of FILTER_KEYS) {
    const r = results[key];
    if (!r) continue;

    traces.push({
      x: times, y: r.values, name: FILTER_NAMES[key],
      type: 'scatter', mode: 'lines',
      line: { color: FILTER_COLORS[key], width: 2 },
      hovertemplate: `<b>${FILTER_NAMES[key]}</b><br>%{x:.2f} h<br>%{y:.4f}<extra></extra>`,
    });

    if (r.settleHours !== null) {
      shapes.push({
        type: 'line',
        x0: r.settleHours, x1: r.settleHours,
        y0: 0, y1: 1,
        line: { color: FILTER_COLORS[key], width: 1, dash: 'dot' },
      });
    }
  }

  const layout = {
    ...BASE_LAYOUT,
    height: 420,
    margin: { t: 16, b: 50, l: 70, r: 20 },
    xaxis: {
      ...AXIS,
      fixedrange: true,
      title: { text: 'Time from step (hours)', font: { size: 11 } },
    },
    yaxis: {
      ...AXIS,
      fixedrange: true,
      title: { text: 'Normalised output', font: { size: 11 } },
      range: [-0.05, 1.12],
    },
    shapes,
  };

  Plotly.react('graph3', traces, layout, GRAPH3_CFG);
  renderSettleInfo(results);
}

function renderSettleInfo(results) {
  const el = document.getElementById('settle-info');
  el.innerHTML = FILTER_KEYS
    .filter((k) => results[k])
    .map((k) => {
      const r = results[k];
      const time = r.settleHours !== null ? fmtSettle(r.settleHours) : 'Did not settle';
      return (
        `<div class="settle-chip">` +
        `<span class="settle-dot" style="background:${FILTER_COLORS[k]}"></span>` +
        `<span class="settle-name">${FILTER_NAMES[k]}:</span>` +
        `<span class="settle-time">${time}</span>` +
        `</div>`
      );
    })
    .join('');
}

function fmtSettle(hrs) {
  if (hrs === 0) return '< 15 min';
  if (hrs < 1) {
    const m = Math.round(hrs * 60);
    return `${m} min`;
  }
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}
