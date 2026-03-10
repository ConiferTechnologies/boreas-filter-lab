# Filter Lab — Project Notes

## Project
Sensor filter design web app — plain HTML/JS, no build tools.

## Files
- `index.html` — Main HTML, two upload zones, three graph sections, filter panel sidebar
- `style.css` — Dark theme (#0b0b1a bg), CSS variables for filter colors
- `filters.js` — All filter algorithms + step response generator
- `app.js` — Upload, state, Plotly rendering
- `examplecsvs/` — Sample CSV files (weight + RoL)

## Data Format (Datadog CSV)
Two separate CSVs: `query, group, time, value` — only `time` and `value` columns are used.
Weight file: `avg:@data.currentWeight`, RoL file: `avg:@data.rateOfLoss`

## Architecture
- CDN: Plotly 2.27.0 + PapaParse 5.4.1
- `filters.js` loaded before `app.js`; `WINDOW_VALUES` defined once in filters.js
- Weight and RoL have independent timestamps — no join needed; Plotly handles separate x-arrays
- Filter functions take `{time: ms, value: number}[]` sorted ascending

## Filter Details
- MA: O(n) sliding window
- Median/PCT: O(n·w) per-point backward scan
- EMA: sample-based alpha
- Step response: 300 samples at 15-min intervals (PRE=100, POST=200)

## Filter Colors
- MA: #00BFFF, Median: #FF6B00, PctClipped: #39FF14, EMA: #FF00FF

## UI Details
- Raw Weight + RoL drawn as white solid lines
- Graph 1 & 2 have "Unlock Graph Axes" checkbox — locked = autoscale/no interaction, unlocked = pan/zoom enabled
- Graph 3 (step response) is fully locked: fixedrange, no modebar, no scrollzoom
- Settle threshold is a number input (1–50%), triggers renderGraph3 on change
- Filter cards have enable/disable toggle checkboxes

## Pending / Discussed Changes
- Add **Hampel filter** as a 5th filter option
  - Parameters: Window size (hrs slider) + K threshold multiplier (default 3)
  - Algorithm: per-point median + MAD, replace outliers with median if |x - median| > k * 1.4826 * MAD
  - Key: 'hmp', Color: TBD (needs high contrast from existing 4)
  - Needs: entry in FILTER_KEYS, FILTER_COLORS, FILTER_NAMES, filters.js function, HTML controls, step response runner
