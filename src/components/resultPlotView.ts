// Display coordinates only. These types and ranges are never part of a project.
export type AxisRange = readonly [number, number];
export type PlotId = 'psi' | 'delta' | 'residual_psi' | 'residual_delta' | 'n' | 'k' | 'k_log';
export interface AutoAxis {range: AxisRange; minimumSpan: number}
export interface PlotDisplay {
  xRange: AxisRange;
  activePlot: PlotId;
  manualY: Partial<Record<PlotId, AxisRange>>;
  onActivate: (id: PlotId) => void;
  onAutoRange: (id: PlotId, axis: AutoAxis) => void;
  kLog: boolean;
  onKLogChange: (log: boolean) => void;
}

export function displayAutoAxis(values: number[], fallback: AxisRange): AutoAxis {
  let low=Infinity, high=-Infinity;
  for (const value of values) if (Number.isFinite(value)) {low=Math.min(low,value);high=Math.max(high,value);}
  if (!Number.isFinite(low)) return {range:fallback,minimumSpan:(fallback[1]-fallback[0])/50};
  const span=high-low, margin=(span||Math.abs(high)||1)*.05;
  return {range:[low-margin,high+margin],minimumSpan:span>0?span/50:margin/25};
}

export function clampDisplayRange(range: AxisRange, full: AxisRange): AxisRange {
  const low=Math.max(full[0],Math.min(full[1],range[0]));
  const high=Math.max(full[0],Math.min(full[1],range[1]));
  return low<high?[low,high]:full;
}

export function formatDisplayTick(value: number, step: number): string {
  const digits=Math.max(0,1-Math.floor(Math.log10(Math.abs(step)||1)));
  return digits>12?value.toExponential(3):Number(value.toFixed(digits)).toString();
}
