/**
 * Fitting Status & Results Bottom Bar
 * Provides live MSE/RMSE metrics, optimizer status, iteration counters,
 * and a collapsible/modal detailed parameter comparison table.
 */
import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  Table,
} from 'lucide-react';
import { FittingResult } from '../types/ellipsometry';
import { MultiAoiResidualMetrics, ResidualMetrics } from '../fitting/residual';

interface FittingStatusBottomBarProps {
  metrics: MultiAoiResidualMetrics | ResidualMetrics;
  fittingResult: FittingResult | null;
  isFitting: boolean;
  currentIter: number;
  liveCost: number;
  prevCost?: number | null;
  liveParams: { name: string; value: number }[];
  paramHistory?: { [name: string]: number[] };
  activeFitAois?: number[];
}

export const FittingStatusBottomBar: React.FC<FittingStatusBottomBarProps> = ({
  metrics,
  fittingResult,
  isFitting,
  currentIter,
  liveCost,
  prevCost,
  liveParams,
  paramHistory,
  activeFitAois,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const multiMetrics = 'perAoi' in metrics ? (metrics as MultiAoiResidualMetrics) : null;
  const isMultiAoi =
    multiMetrics?.fittingMode === 'multi_aoi' ||
    fittingResult?.fittingMode === 'multi_aoi' ||
    (activeFitAois && activeFitAois.length > 1);

  return (
    <>
      <footer className="fitting-status-bar h-10 bg-slate-900 border-t border-slate-800 px-4 flex items-center justify-between select-none shrink-0 text-xs z-10">
        {/* Left: Optimizer status badge */}
        <div className="flex items-center space-x-3 overflow-hidden">
          {isFitting ? (
            <div className="flex items-center space-x-2 text-cyan-400 font-medium shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span>
                {isMultiAoi ? '全域多角度 (Multi-AOI) 擬合中...' : '最佳化擬合中...'} 迭代第 {currentIter} 次
              </span>
              <span className="text-slate-400 font-mono text-[11px]">
                [MSE (Woollam): {liveCost.toFixed(5)} | 前次: {prevCost !== null && prevCost !== undefined ? prevCost.toFixed(5) : '—'}]
              </span>
            </div>
          ) : fittingResult ? (
            <div className="flex items-center space-x-2 shrink-0">
              {(fittingResult.status === 'target_achieved' ||
                (fittingResult.rawMse !== undefined && fittingResult.rawMse < (fittingResult.targetMse ?? 10.0))) && (
                <div className="flex items-center space-x-1.5 text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    TARGET ACHIEVED (Raw MSE: {(fittingResult.rawMse ?? fittingResult.finalMse).toFixed(4)} &lt;{' '}
                    {(fittingResult.targetMse ?? 10.0).toFixed(1)})
                  </span>
                </div>
              )}
              {(fittingResult.status === 'target_not_achieved' ||
                fittingResult.status === 'not_converged' ||
                (fittingResult.status === 'converged' &&
                  (fittingResult.rawMse ?? fittingResult.finalMse) >= (fittingResult.targetMse ?? 10.0))) && (
                <div className="flex items-center space-x-1.5 text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span>
                    TARGET NOT ACHIEVED (Raw MSE: {(fittingResult.rawMse ?? fittingResult.finalMse).toFixed(4)} ≥{' '}
                    {(fittingResult.targetMse ?? 10.0).toFixed(1)})
                  </span>
                </div>
              )}
              {fittingResult.status === 'failed' && (
                <div className="flex items-center space-x-1.5 text-rose-400 font-medium">
                  <AlertCircle className="w-4 h-4" />
                  <span>擬合失敗：未能改善目標誤差 ({fittingResult.iterations} 次迭代)</span>
                </div>
              )}
              {fittingResult.status === 'stopped' && (
                <div className="flex items-center space-x-1.5 text-amber-400 font-medium">
                  <AlertCircle className="w-4 h-4" />
                  <span>使用者中斷擬合 ({fittingResult.iterations} 次迭代)</span>
                </div>
              )}
              {fittingResult.status === 'max_iter' && (
                <div className="flex items-center space-x-1.5 text-yellow-400 font-medium">
                  <Clock className="w-4 h-4" />
                  <span>達到最大迭代次數 ({fittingResult.iterations} 次)</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 text-slate-400 shrink-0">
              <Activity className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {isMultiAoi
                  ? `多角度即時計算模式 [AOI: ${activeFitAois?.join('°, ') || 'All'}°]`
                  : '手動即時計算模式 (擬合波長: 190 nm ~ 900 nm)'}
              </span>
            </div>
          )}

          {/* Live Parameter Tracker during optimization */}
          {isFitting && liveParams.length > 0 && (
            <div className="hidden xl:flex items-center space-x-2 pl-3 border-l border-slate-800 text-[11px] font-mono text-slate-400 truncate max-w-xs">
              {liveParams.slice(0, 3).map((p, idx) => (
                <span key={idx}>
                  {p.name}: <b className="text-slate-200">{p.value}</b>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Center / Right: Numerical Statistical Metrics */}
        <div className="flex items-center space-x-3 font-mono">
          {/* Per-AOI MSE breakdown pills */}
          {multiMetrics?.perAoi && Object.keys(multiMetrics.perAoi).length > 1 && (
            <div className="hidden md:flex items-center space-x-1.5 text-[11px] border-r border-slate-800 pr-3">
              {Object.entries(multiMetrics.perAoi).map(([aoiStr, m]) => (
                <span
                  key={aoiStr}
                  className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700 text-slate-300"
                >
                  <span className="text-slate-500">{aoiStr}°:</span>{' '}
                  <span className="text-cyan-300 font-medium">{m.mseWoollam.toFixed(4)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center space-x-1 text-slate-400">
            <span>MSE (Woollam):</span>
            <span className="text-slate-100 font-bold">{(isFitting?liveCost:metrics.mseWoollam).toFixed(4)}</span>
            <small>Raw MSE {metrics.rawMse.toFixed(4)} deg² · χ²ᵣ {metrics.reducedChiSquare.toFixed(4)}</small>
            {metrics.weightingWarning&&<small role="alert" title={metrics.weightingWarning} className="text-amber-300 max-w-56 truncate">{metrics.weightingWarning}</small>}
            {fittingResult?.converged===false&&<small className="text-amber-300">未收斂</small>}
          </div>

          {'weightedMse' in metrics &&
            metrics.weightedMse !== undefined &&
            Math.abs(metrics.weightedMse - (metrics.rawMse ?? metrics.mse)) > 1e-4 && (
              <div className="hidden lg:flex items-center space-x-1 text-slate-400 border-l border-slate-800 pl-2">
                <span>Weighted MSE:</span>
                <span className="text-amber-300 font-semibold">{metrics.weightedMse.toFixed(4)}</span>
              </div>
            )}

          <div className="flex items-center space-x-1 text-slate-400">
            <span>RMSE:</span>
            <span className="text-cyan-400 font-semibold">{metrics.rmse.toFixed(4)}</span>
          </div>

          <div className="hidden sm:flex items-center space-x-1 text-slate-400">
            <span>點數:</span>
            <span className="text-slate-200">{metrics.totalPoints}</span>
          </div>

          {/* Toggle Results Table */}
          {fittingResult && fittingResult.parameters.length > 0 && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center space-x-1 text-[11px]"
            >
              <Table className="w-3 h-3" />
              <span>擬合成果報告 ({fittingResult.parameters.length})</span>
              {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          )}
        </div>
      </footer>

      {/* Collapsible Parameter Comparison Modal/Dropup */}
      {showDetails && fittingResult && (
        <div className="fixed bottom-10 right-4 w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-t-lg shadow-2xl z-30 overflow-hidden text-xs">
          <div className="p-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Table className="w-4 h-4 text-cyan-400" />
              <div>
                <span className="font-semibold text-slate-100 block">
                  非線性最小平方法 (LM) 擬合成果報告
                </span>
                <span className="text-[10px] text-slate-400">
                  {fittingResult.fittingMode === 'multi_aoi'
                    ? `模式: Global Multi-AOI 聯立擬合 (入射角: ${fittingResult.selectedAois?.join('°, ')}°，共用單一物理膜層)`
                    : '模式: Single-AOI 單入射角擬合'}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowDetails(false)}
              className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded hover:bg-slate-700"
            >
              ✕ 關閉
            </button>
          </div>

          {/* Global Summary Stats */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800 grid grid-cols-6 gap-2 font-mono text-[11px] text-slate-300">
            <div>
              <span className="text-slate-500 block">初始 Raw MSE / RMSE</span>
              <span className="text-amber-400 font-bold">
                {fittingResult.initialMse.toFixed(4)} / {fittingResult.initialRmse.toFixed(4)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">最終 Raw MSE / RMSE</span>
              <span className="text-emerald-400 font-bold">
                {fittingResult.finalMse.toFixed(4)} / {fittingResult.finalRmse.toFixed(4)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">誤差改善率</span>
              <span className="text-cyan-400 font-bold">
                {fittingResult.initialMse > 0
                  ? (
                      ((fittingResult.initialMse - fittingResult.finalMse) /
                        fittingResult.initialMse) *
                      100
                    ).toFixed(1) + '%'
                  : '0%'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">最終膜厚 (Thickness)</span>
              <span className="text-cyan-300 font-bold">
                {(() => {
                  const tParam = fittingResult.parameters.find(
                    (p) => p.paramId === 'thickness' || p.paramName.toLowerCase().includes('thickness')
                  );
                  return tParam ? `${tParam.finalValue.toFixed(2)} nm` : '—';
                })()}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Ψ / Δ RMSE</span>
              <span className="text-slate-200 font-medium">
                {Math.sqrt('psiMse' in metrics ? metrics.psiMse : 0).toFixed(3)}° /{' '}
                {Math.sqrt('deltaMse' in metrics ? metrics.deltaMse : 0).toFixed(3)}°
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">迭代 / 狀態</span>
              <span className="text-slate-200">
                {fittingResult.iterations} 次 ({fittingResult.status})
              </span>
            </div>
          </div>

          {/* Per-AOI Breakdown if available */}
          {fittingResult.perAoiMse && Object.keys(fittingResult.perAoiMse).length > 1 && (
            <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center space-x-3 text-[11px] font-mono">
              <span className="text-slate-400 font-sans font-medium">各入射角 MSE:</span>
              {Object.entries(fittingResult.perAoiMse).map(([aoiStr, mseVal]) => (
                <span
                  key={aoiStr}
                  className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200"
                >
                  <b className="text-cyan-400">{aoiStr}°</b> AOI: {mseVal.toFixed(5)}
                </span>
              ))}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto p-2">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="p-2">參數名稱</th>
                  <th className="p-2">初始值</th>
                  <th className="p-2">擬合最佳值</th>
                  <th className="p-2">邊界 [Min, Max]</th>
                  <th className="p-2 text-right">變化量 Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {fittingResult.parameters.map((p, idx) => {
                  const change = p.finalValue - p.initialValue;
                  const changeSign = change >= 0 ? '+' : '';
                  const history = paramHistory && paramHistory[p.paramName];
                  const transitionStr =
                    history && history.length > 1
                      ? history.slice(0, 5).map((v) => v.toFixed(2)).join(' → ') +
                        (history.length > 5 ? ` → ... → ${p.finalValue.toFixed(2)}` : '')
                      : `${p.initialValue.toFixed(2)} → ${p.finalValue.toFixed(2)}`;

                  return (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="p-2 font-sans font-medium text-slate-200">
                        <div>{p.paramName}</div>
                        <div className="text-[10px] text-cyan-400 font-mono mt-0.5">
                          路徑: {transitionStr} {p.unit}
                        </div>
                      </td>
                      <td className="p-2 text-slate-400">
                        {p.initialValue.toFixed(4)} {p.unit}
                      </td>
                      <td className="p-2 text-cyan-300 font-bold">
                        {p.finalValue.toFixed(4)} {p.unit}
                      </td>
                      <td className="p-2 text-slate-500">
                        [{p.min}, {p.max}]
                      </td>
                      <td
                        className={`p-2 text-right font-semibold ${
                          Math.abs(change) < 1e-4
                            ? 'text-slate-400'
                            : change > 0
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {changeSign}
                        {change.toFixed(4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};
