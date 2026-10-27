/**
 * Visualizer Panel (Center Panel)
 * Renders scientific spectroscopic graphs for:
 * 1. Experimental Ψ vs Calculated Ψ
 * 2. Experimental Δ vs Calculated Δ
 * 3. Ψ Residual (R_Ψ)
 * 4. Δ Residual (R_Δ)
 *
 * Supports interactive crosshair readout, angle filtering, series toggling, and zoom controls.
 */
import React, { useState, useRef, useMemo } from 'react';
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Eye,
  EyeOff,
  Filter,
} from 'lucide-react';
import {
  EllipsometryDataPoint,
  VisualizationSettings,
} from '../types/ellipsometry';

interface VisualizerPanelProps {
  points: EllipsometryDataPoint[];
  angles: number[];
  settings: VisualizationSettings;
  onUpdateSettings: (settings: VisualizationSettings) => void;
  activeFitAois?: number[];
  onToggleFitAoi?: (aoi: number) => void;
  onSelectAllFitAois?: (all: boolean) => void;
  perAoiMetrics?: Record<number, { mse: number; rmse: number }>;
}

export const VisualizerPanel: React.FC<VisualizerPanelProps> = ({
  points,
  angles,
  settings,
  onUpdateSettings,
  activeFitAois,
  onToggleFitAoi,
  onSelectAllFitAois,
  perAoiMetrics,
}) => {
  const [hoverData, setHoverData] = useState<{
    wavelength: number;
    aoi: number;
    psiExp?: number;
    psiCalc?: number;
    deltaExp?: number;
    deltaCalc?: number;
    psiRes?: number;
    deltaRes?: number;
  } | null>(null);

  const [zoomScale, setZoomScale] = useState<number>(1.0);

  // Filter points based on selected angle
  const filteredPoints = useMemo(() => {
    if (settings.selectedAoi === 'all') return points;
    return points.filter((p) => p.aoi === settings.selectedAoi);
  }, [points, settings.selectedAoi]);

  // Compute extents
  const { wlMin:baseMin, wlMax:baseMax, distinctAngles } = useMemo(() => {
    if (filteredPoints.length === 0) {
      return { wlMin: 300, wlMax: 800, distinctAngles: [] };
    }
    let minW = Infinity;
    let maxW = -Infinity;
    const aSet = new Set<number>();

    filteredPoints.forEach((p) => {
      if (p.wavelength < minW) minW = p.wavelength;
      if (p.wavelength > maxW) maxW = p.wavelength;
      aSet.add(p.aoi);
    });

    return {
      wlMin: Math.max(100, minW),
      wlMax: Math.max(minW + 10, maxW),
      distinctAngles: Array.from(aSet).sort((a, b) => a - b),
    };
  }, [filteredPoints]);

  const viewSpan=(baseMax-baseMin)/zoomScale;
  const wlMin=(baseMin+baseMax-viewSpan)/2,wlMax=wlMin+viewSpan;

  // Shared UI tokens; dash patterns distinguish incidence angles without relying on color.
  const DYNAMIC_PALETTE = Array.from({ length: 8 }, () => ({
    exp: 'var(--measurement)', calc: 'var(--accent)', res: 'var(--residual)',
  }));

  const getColorForAngle = (aoi: number) => {
    const idx = distinctAngles.indexOf(aoi);
    if (idx >= 0) {
      return DYNAMIC_PALETTE[idx % DYNAMIC_PALETTE.length];
    }
    // Fallback hash based on numerical aoi
    const hashIdx = Math.abs(Math.round(aoi * 7)) % DYNAMIC_PALETTE.length;
    return DYNAMIC_PALETTE[hashIdx];
  };

  // SVG Chart Dimensions
  const width = 640;
  const height = 240;
  const padding = { top: 20, right: 30, bottom: 35, left: 55 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Scale functions
  const scaleX = (wl: number) => {
    return padding.left + ((wl - wlMin) / (wlMax - wlMin)) * innerWidth;
  };

  const scaleY = (val: number, yMin: number, yMax: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return padding.top + innerHeight - ((clamped - yMin) / (yMax - yMin)) * innerHeight;
  };

  // Render Single Scientific Plot (Psi, Delta, or Residual)
  const renderPlot = (
    title: string,
    yLabel: string,
    yMin: number,
    yMax: number,
    dataKind: 'psi' | 'delta' | 'residual_psi' | 'residual_delta'
  ) => {
    // Generate horizontal gridlines
    const yTicksCount = 5;
    const yStep = (yMax - yMin) / yTicksCount;
    const yTicks = Array.from({ length: yTicksCount + 1 }, (_, i) => yMin + i * yStep);

    // Generate vertical gridlines (wavelength)
    const xTicksCount = 6;
    const xStep = (wlMax - wlMin) / xTicksCount;
    const xTicks = Array.from({ length: xTicksCount + 1 }, (_, i) => wlMin + i * xStep);

    // Group points by AOI for clean line tracing
    const pointsByAngle: Record<number, EllipsometryDataPoint[]> = {};
    filteredPoints.forEach((p) => {
      if(p.wavelength<wlMin||p.wavelength>wlMax)return;
      if (!pointsByAngle[p.aoi]) pointsByAngle[p.aoi] = [];
      pointsByAngle[p.aoi].push(p);
    });

    Object.values(pointsByAngle).forEach((arr) =>
      arr.sort((a, b) => a.wavelength - b.wavelength)
    );

    const handleMouseMove = (e: React.PointerEvent<SVGSVGElement>) => {
      const point=e.currentTarget.createSVGPoint();point.x=e.clientX;point.y=e.clientY;
      const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;
      const svgX=point.matrixTransform(matrix.inverse()).x;

      // Find closest wavelength
      const targetWl = wlMin + ((svgX - padding.left) / innerWidth) * (wlMax - wlMin);

      let closest: EllipsometryDataPoint | null = null;
      let minDistance = Infinity;

      filteredPoints.forEach((p) => {
        const dist = Math.abs(p.wavelength - targetWl);
        if (dist < minDistance) {
          minDistance = dist;
          closest = p;
        }
      });

      if (closest) {
        const c = closest as EllipsometryDataPoint;
        setHoverData({
          wavelength: c.wavelength,
          aoi: c.aoi,
          psiExp: c.psiExp,
          psiCalc: c.psiCalc,
          deltaExp: c.deltaExp,
          deltaCalc: c.deltaCalc,
          psiRes: c.psiResidual,
          deltaRes: c.deltaResidual,
        });
      }
    };

    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col flex-1 shadow-sm">
        {/* Plot Title & Sub-legend */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-100">{title}</span>
            <span className="text-[10px] text-slate-400 font-mono">({yLabel})</span>
          </div>

          <div className="flex items-center space-x-3 text-[11px]">
            {distinctAngles.map((aoi) => {
              const c = getColorForAngle(aoi);
              return (
                <div key={aoi} className="flex items-center space-x-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: c.exp }}
                  />
                  <span className="text-slate-300 font-mono">{aoi}°</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* SVG Plot */}
        <div className="relative flex-1 min-h-[180px]">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full cursor-crosshair overflow-visible select-none"
            onPointerMove={handleMouseMove}
            onPointerLeave={() => setHoverData(null)}
          >
            {/* Background Grid */}
            <rect
              x={padding.left}
              y={padding.top}
              width={innerWidth}
              height={innerHeight}
              fill="var(--card)"
              stroke="var(--card-border)"
            />

            {/* Zero line for residuals */}
            {(dataKind === 'residual_psi' || dataKind === 'residual_delta') && yMin < 0 && yMax > 0 && (
              <line
                x1={padding.left}
                y1={scaleY(0, yMin, yMax)}
                x2={padding.left + innerWidth}
                y2={scaleY(0, yMin, yMax)}
                stroke="var(--text-muted)"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
            )}

            {/* Horizontal Grid lines */}
            {yTicks.map((val, idx) => {
              const y = scaleY(val, yMin, yMax);
              return (
                <g key={`y-${idx}`}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={padding.left + innerWidth}
                    y2={y}
                    stroke="var(--card-border)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padding.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {val.toFixed(val % 1 === 0 ? 0 : 1)}
                  </text>
                </g>
              );
            })}

            {/* Vertical Grid lines */}
            {xTicks.map((val, idx) => {
              const x = scaleX(val);
              return (
                <g key={`x-${idx}`}>
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={padding.top + innerHeight}
                    stroke="var(--card-border)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={x}
                    y={padding.top + innerHeight + 16}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {Math.round(val)}
                  </text>
                </g>
              );
            })}

            {/* Axis Titles */}
            <text
              x={padding.left + innerWidth / 2}
              y={height - 4}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="11"
              fontWeight="500"
            >
              波長 λ (nm)
            </text>

            <text
              transform={`rotate(-90 ${16} ${padding.top + innerHeight / 2})`}
              x={16}
              y={padding.top + innerHeight / 2}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="11"
              fontWeight="500"
            >
              {yLabel}
            </text>

            {/* Data Series Traces */}
            {Object.entries(pointsByAngle).map(([aoiStr, pts]) => {
              const aoi = parseFloat(aoiStr);
              const color = getColorForAngle(aoi);
              const denseMeasured = pts.length>2000&&settings.showExperimental&&(dataKind==='psi'||dataKind==='delta') ?
                <polyline points={pts.map(p=>`${scaleX(p.wavelength)},${scaleY(dataKind==='psi'?p.psiExp:p.deltaExp,yMin,yMax)}`).join(' ')} fill="none" stroke={color.exp} strokeWidth="1"/> : null;

              if (dataKind === 'psi') {
                // Calculated Line
                const calcPath = pts
                  .filter((p) => p.psiCalc !== undefined)
                  .map((p, idx) => {
                    const x = scaleX(p.wavelength);
                    const y = scaleY(p.psiCalc!, yMin, yMax);
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ');

                return (
                  <g key={`psi-${aoi}`}>{denseMeasured}
                    {settings.showCalculated && calcPath && (
                      <path
                        d={calcPath}
                        fill="none"
                        stroke={color.calc} strokeDasharray={[undefined, "6 3", "2 3", "8 3 2 3"][distinctAngles.indexOf(aoi) % 4]}
                        strokeWidth="2.0"
                      />
                    )}
                    {settings.showExperimental &&
                      (pts.length<=2000?pts:[]).map((p) => {
                        const x = scaleX(p.wavelength);
                        const y = scaleY(p.psiExp, yMin, yMax);
                        return (
                          <circle
                            key={p.id}
                            cx={x}
                            cy={y}
                            r="2.5"
                            fill={color.exp}
                            stroke="var(--card)"
                            strokeWidth="0.8"
                          />
                        );
                      })}
                  </g>
                );
              }

              if (dataKind === 'delta') {
                // Calculated Line
                const calcPath = pts
                  .filter((p) => p.deltaCalc !== undefined)
                  .map((p, idx) => {
                    const x = scaleX(p.wavelength);
                    const y = scaleY(p.deltaCalc!, yMin, yMax);
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ');

                return (
                  <g key={`delta-${aoi}`}>{denseMeasured}
                    {settings.showCalculated && calcPath && (
                      <path
                        d={calcPath}
                        fill="none"
                        stroke={color.calc} strokeDasharray={[undefined, "6 3", "2 3", "8 3 2 3"][distinctAngles.indexOf(aoi) % 4]}
                        strokeWidth="2.0"
                      />
                    )}
                    {settings.showExperimental &&
                      (pts.length<=2000?pts:[]).map((p) => {
                        const x = scaleX(p.wavelength);
                        const y = scaleY(p.deltaExp, yMin, yMax);
                        return (
                          <circle
                            key={p.id}
                            cx={x}
                            cy={y}
                            r="2.5"
                            fill={color.exp}
                            stroke="var(--card)"
                            strokeWidth="0.8"
                          />
                        );
                      })}
                  </g>
                );
              }

              if (dataKind === 'residual_psi') {
                const resPath = pts
                  .filter((p) => p.psiResidual !== undefined)
                  .map((p, idx) => {
                    const x = scaleX(p.wavelength);
                    const y = scaleY(p.psiResidual!, yMin, yMax);
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ');

                return (
                  <g key={`res-psi-${aoi}`}>
                    {resPath && (
                      <path
                        d={resPath}
                        fill="none"
                        stroke={color.res}
                        strokeWidth="1.5"
                      />
                    )}
                    {(pts.length<=2000?pts:[]).map((p) => {
                      if (p.psiResidual === undefined) return null;
                      const x = scaleX(p.wavelength);
                      const y = scaleY(p.psiResidual, yMin, yMax);
                      return (
                        <circle
                          key={p.id}
                          cx={x}
                          cy={y}
                          r="2.0"
                          fill={color.res}
                        />
                      );
                    })}
                  </g>
                );
              }

              if (dataKind === 'residual_delta') {
                const resPath = pts
                  .filter((p) => p.deltaResidual !== undefined)
                  .map((p, idx) => {
                    const x = scaleX(p.wavelength);
                    const y = scaleY(p.deltaResidual!, yMin, yMax);
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ');

                return (
                  <g key={`res-delta-${aoi}`}>
                    {resPath && (
                      <path
                        d={resPath}
                        fill="none"
                        stroke={color.res}
                        strokeWidth="1.5"
                      />
                    )}
                    {(pts.length<=2000?pts:[]).map((p) => {
                      if (p.deltaResidual === undefined) return null;
                      const x = scaleX(p.wavelength);
                      const y = scaleY(p.deltaResidual, yMin, yMax);
                      return (
                        <circle
                          key={p.id}
                          cx={x}
                          cy={y}
                          r="2.0"
                          fill={color.res}
                        />
                      );
                    })}
                  </g>
                );
              }

              return null;
            })}

            {/* Hover Crosshair vertical line */}
            {hoverData && (
              <line
                x1={scaleX(hoverData.wavelength)}
                y1={padding.top}
                x2={scaleX(hoverData.wavelength)}
                y2={padding.top + innerHeight}
                stroke="var(--accent)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            )}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <main id="spectra-panel" className="ui1-surface visualizer-panel flex-1 flex flex-col bg-slate-950 p-3 overflow-hidden select-none min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        <button aria-label="Zoom wavelength in" className="px-2 py-1 border border-slate-700 rounded" onClick={()=>setZoomScale(z=>Math.min(8,z*1.5))}>Zoom in</button>
        <button aria-label="Zoom wavelength out" className="px-2 py-1 border border-slate-700 rounded" onClick={()=>setZoomScale(z=>Math.max(1,z/1.5))}>Zoom out</button>
        <button aria-label="Reset wavelength zoom" className="px-2 py-1 border border-slate-700 rounded" onClick={()=>setZoomScale(1)}>Reset zoom</button>
        <span>{wlMin.toFixed(1)}–{wlMax.toFixed(1)} nm · {zoomScale.toFixed(2)}× display only</span>
      </div>
      {/* Visualizer Top Bar Controls */}
      <div className="flex items-center justify-between pb-3 shrink-0">
        {/* Tabs: Both, Psi, Delta, Residuals */}
        <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            aria-pressed={settings.activeTab === 'both'}
            onClick={() => onUpdateSettings({ ...settings, activeTab: 'both' })}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              settings.activeTab === 'both'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ψ & Δ 總覽圖
          </button>
          <button
            aria-pressed={settings.activeTab === 'psi'}
            onClick={() => onUpdateSettings({ ...settings, activeTab: 'psi' })}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              settings.activeTab === 'psi'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            僅檢視 Ψ
          </button>
          <button
            aria-pressed={settings.activeTab === 'delta'}
            onClick={() => onUpdateSettings({ ...settings, activeTab: 'delta' })}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              settings.activeTab === 'delta'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            僅檢視 Δ
          </button>
          <button
            aria-pressed={settings.activeTab === 'residuals'}
            onClick={() => onUpdateSettings({ ...settings, activeTab: 'residuals' })}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              settings.activeTab === 'residuals'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            殘差分佈 (R_Ψ, R_Δ)
          </button>
        </div>

        {/* Filters & Toggles */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Quick-Switch AOI View Buttons */}
          {angles.length > 1 && (
            <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded p-1">
              <span className="text-slate-400 px-1 text-[11px] flex items-center space-x-1">
                <Filter className="w-3 h-3 text-slate-500" />
                <span>檢視:</span>
              </span>
              <button
                onClick={() => onUpdateSettings({ ...settings, selectedAoi: 'all' })}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  settings.selectedAoi === 'all'
                    ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                All AOIs
              </button>
              {angles.map((a) => {
                const isSelected = settings.selectedAoi === a;
                const col = getColorForAngle(a);
                return (
                  <button
                    key={a}
                    onClick={() => onUpdateSettings({ ...settings, selectedAoi: a })}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors flex items-center space-x-1 ${
                      isSelected
                        ? 'bg-slate-800 text-white border border-slate-600'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: col.exp }}
                    />
                    <span>{a}°</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Fit Targets Multi-AOI Selection */}
          {angles.length > 1 && onToggleFitAoi && (
            <div className="flex items-center space-x-1.5 bg-slate-900/90 border border-slate-800 rounded px-2 py-1">
              <span className="text-[11px] text-slate-400 font-medium">參與擬合:</span>
              {angles.map((a) => {
                const isFitActive = !activeFitAois || activeFitAois.includes(a);
                const col = getColorForAngle(a);
                const aoiMetric = perAoiMetrics?.[a];

                return (
                  <label
                    key={a}
                    className={`flex items-center space-x-1 cursor-pointer px-1.5 py-0.5 rounded text-[11px] font-mono border transition-all ${
                      isFitActive
                        ? 'bg-slate-800/90 border-slate-600 text-slate-100 shadow-xs'
                        : 'bg-slate-950 border-slate-800/80 text-slate-500 opacity-60'
                    }`}
                    title={`點擊切換 ${a}° 是否參與全域最佳化擬合`}
                  >
                    <input
                      type="checkbox"
                      checked={isFitActive}
                      onChange={() => onToggleFitAoi(a)}
                      className="rounded border-slate-700 text-cyan-600 focus:ring-0 w-3 h-3"
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: isFitActive ? col.exp : 'var(--text-muted)' }}
                    />
                    <span>{a}°</span>
                    {aoiMetric && (
                      <span className="text-[10px] text-cyan-400/90 ml-0.5">
                        ({aoiMetric.mse.toFixed(3)})
                      </span>
                    )}
                  </label>
                );
              })}

              {onSelectAllFitAois && (
                <button
                  onClick={() => {
                    const allSelected = !activeFitAois || activeFitAois.length === angles.length;
                    onSelectAllFitAois(!allSelected);
                  }}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 ml-1 underline"
                >
                  {!activeFitAois || activeFitAois.length === angles.length ? '單選首個' : '全選'}
                </button>
              )}
            </div>
          )}

          {/* Series Toggles */}
          <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded p-1">
            <button
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  showExperimental: !settings.showExperimental,
                })
              }
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1 ${
                settings.showExperimental
                  ? 'bg-slate-800 text-amber-300'
                  : 'text-slate-500 line-through'
              }`}
            >
              <span>實驗數據 (Exp)</span>
            </button>
            <button
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  showCalculated: !settings.showCalculated,
                })
              }
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1 ${
                settings.showCalculated
                  ? 'bg-slate-800 text-cyan-300'
                  : 'text-slate-500 line-through'
              }`}
            >
              <span>理論曲線 (Calc)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Crosshair Readout Bar */}
      {hoverData && (
        <div className="mb-2 px-3 py-1.5 bg-slate-900/90 border border-cyan-800/40 rounded-md text-xs font-mono flex items-center justify-between text-slate-300 shadow-sm shrink-0">
          <div className="flex items-center space-x-4">
            <span className="text-cyan-400 font-bold">
              λ = {hoverData.wavelength.toFixed(1)} nm
            </span>
            <span className="text-slate-400">入射角 = {hoverData.aoi}°</span>
          </div>

          <div className="flex items-center space-x-4">
            {hoverData.psiExp !== undefined && (
              <span>
                Ψ_exp = <b className="text-amber-400">{hoverData.psiExp.toFixed(2)}°</b>
              </span>
            )}
            {hoverData.psiCalc !== undefined && (
              <span>
                Ψ_calc = <b className="text-cyan-400">{hoverData.psiCalc.toFixed(2)}°</b>
              </span>
            )}
            {hoverData.deltaExp !== undefined && (
              <span>
                Δ_exp = <b className="text-amber-400">{hoverData.deltaExp.toFixed(2)}°</b>
              </span>
            )}
            {hoverData.deltaCalc !== undefined && (
              <span>
                Δ_calc = <b className="text-cyan-400">{hoverData.deltaCalc.toFixed(2)}°</b>
              </span>
            )}
            {hoverData.psiRes !== undefined && (
              <span>
                R_Ψ = <b className="text-slate-200">{hoverData.psiRes.toFixed(3)}°</b>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Grid of Plots based on active tab */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden">
        {settings.activeTab === 'both' && (
          <>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0">
              {renderPlot('Ψ (Psi) 光譜響應曲線', 'Ψ 振幅角 (度 °)', 0, 90, 'psi')}
              {renderPlot('Δ (Delta) 相位差光譜', 'Δ 相位角 (度 °)', 0, 360, 'delta')}
            </div>
            {settings.showResiduals && (
              <div className="h-44 grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
                {renderPlot('Ψ 擬合殘差 (Calc - Exp)', '殘差 ΔΨ (°)', -3, 3, 'residual_psi')}
                {renderPlot('Δ 擬合殘差 (Calc - Exp)', '殘差 ΔΔ (°)', -10, 10, 'residual_delta')}
              </div>
            )}
          </>
        )}

        {settings.activeTab === 'psi' && (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {renderPlot('Ψ (Psi) 光譜響應曲線', 'Ψ 振幅角 (度 °)', 0, 90, 'psi')}
            {settings.showResiduals && (
              <div className="h-44 shrink-0">
                {renderPlot('Ψ 擬合殘差 (Calc - Exp)', '殘差 ΔΨ (°)', -3, 3, 'residual_psi')}
              </div>
            )}
          </div>
        )}

        {settings.activeTab === 'delta' && (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {renderPlot('Δ (Delta) 相位差光譜', 'Δ 相位角 (度 °)', 0, 360, 'delta')}
            {settings.showResiduals && (
              <div className="h-44 shrink-0">
                {renderPlot('Δ 擬合殘差 (Calc - Exp)', '殘差 ΔΔ (°)', -10, 10, 'residual_delta')}
              </div>
            )}
          </div>
        )}

        {settings.activeTab === 'residuals' && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0">
            {renderPlot('Ψ 殘差分佈 (R_Ψ)', '殘差 ΔΨ (°)', -5, 5, 'residual_psi')}
            {renderPlot('Δ 殘差分佈 (R_Δ)', '殘差 ΔΔ (°)', -20, 20, 'residual_delta')}
          </div>
        )}
      </div>
    </main>
  );
};
