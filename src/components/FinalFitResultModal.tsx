/**
 * AutoEllipso — Final Fitting Results & Diagnostics Modal
 *
 * Implements:
 * - Unfalsified outcome presentation: TARGET ACHIEVED vs TARGET NOT ACHIEVED
 * - B-spline Diagnostic Summary (Raw MSE, RMSE, Psi RMSE, Delta RMSE)
 * - Physical Model Mismatch Alert
 * - Fresh Forward Recalculation verification badge
 * - Export buttons for AutoEllipso:
 *   1. AutoEllipso_optical_constants.csv
 *   2. AutoEllipso_fitted_curve.csv
 *   3. AutoEllipso_fitted_parameters.json
 */

import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Download,
  Info,
  Layers,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { FittingResult, Layer } from '../types/ellipsometry';

interface FinalFitResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  fittingResult: FittingResult;
  primaryLayer: Layer;
  onExportNk: () => void;
  onExportFullReport: () => void;
  onExportParametersJson?: () => void;
  targetMse?: number;
}

export const FinalFitResultModal: React.FC<FinalFitResultModalProps> = ({
  isOpen,
  onClose,
  fittingResult,
  primaryLayer,
  onExportNk,
  onExportFullReport,
  onExportParametersJson,
  targetMse = 10.0,
}) => {
  if (!isOpen) return null;

  const rawMse = fittingResult.rawMse ?? fittingResult.finalMse;
  const rawRmse = fittingResult.rawRmse ?? fittingResult.finalRmse;
  const psiRmse = fittingResult.psiRmse;
  const deltaRmse = fittingResult.deltaRmse;
  const isTargetAchieved = rawMse < targetMse;

  // Extract fitted thickness
  const thicknessParam = fittingResult.parameters.find(
    (p) => p.paramId === 'thickness' || p.paramName.toLowerCase().includes('thickness')
  );
  const finalThickness = thicknessParam ? thicknessParam.finalValue : primaryLayer.thickness;

  const bsplineDiag = fittingResult.bsplineDiagnostic;
  const multiStartSummary = fittingResult.multiStartSummary;
  const isPhysicalModelMismatch = fittingResult.physicalModelMismatch;

  const defaultPossibleCauses = [
    '光學色散模型不匹配 (Optical model mismatch) - 膜層可能具有未涵蓋的帶尾吸收或複雜晶態',
    '入射角校準偏差 (Incorrect AOI) - 量測時之物理角度可能存在微小系統偏差',
    '基底光學常數偏差 (Incorrect substrate n/k) - 矽晶圓或玻璃之天然氧化層/吸收常數可能不同於標準庫',
    '樣品界面層效應 (Interfacial oxide) 或表面粗糙度效應',
  ];

  const causesToDisplay =
    fittingResult.possibleCauses && fittingResult.possibleCauses.length > 0
      ? fittingResult.possibleCauses
      : defaultPossibleCauses;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Status Banner */}
        <div
          className={`p-5 border-b flex items-start justify-between ${
            isTargetAchieved
              ? 'bg-emerald-950/40 border-emerald-700/60'
              : 'bg-rose-950/40 border-rose-700/60'
          }`}
        >
          <div className="flex items-start space-x-3">
            {isTargetAchieved ? (
              <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            ) : (
              <div className="p-2 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
            )}
            <div>
              <div className="flex items-center space-x-2">
                <span
                  className={`text-base font-extrabold tracking-wide ${
                    isTargetAchieved ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {isTargetAchieved ? 'TARGET ACHIEVED (目標達成)' : 'TARGET NOT ACHIEVED (未達標)'}
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900/80 text-slate-300 border border-slate-700">
                  Target MSE: &lt; {targetMse.toFixed(1)}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                {isTargetAchieved
                  ? `真實正向驗算通過！Raw MSE: ${rawMse.toFixed(4)} 達成嚴格物理門檻。`
                  : `最終 Raw MSE: ${rawMse.toFixed(4)} ≥ ${targetMse.toFixed(1)}。數據已完整擬合至收斂點，請參閱下方診斷分析。`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-200 divide-y divide-slate-800">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/80">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">
                Final Raw MSE
              </span>
              <span
                className={`text-lg font-bold font-mono ${
                  isTargetAchieved ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {rawMse.toFixed(4)}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">無加權真實均方誤差</span>
            </div>

            <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/80">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">
                Ψ / Δ RMSE
              </span>
              <span className="text-sm font-bold font-mono text-cyan-300 block mt-1">
                {psiRmse !== undefined ? `${psiRmse.toFixed(3)}°` : `${rawRmse.toFixed(3)}°`} /{' '}
                {deltaRmse !== undefined ? `${deltaRmse.toFixed(3)}°` : `${rawRmse.toFixed(3)}°`}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                總 RMSE: {rawRmse.toFixed(4)}°
              </span>
            </div>

            <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/80">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">
                Fitted Thickness d
              </span>
              <span className="text-lg font-bold font-mono text-cyan-300">
                {finalThickness.toFixed(2)} nm
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">薄膜反演最終厚度</span>
            </div>

            <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/80">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">
                Multi-Start &amp; TMM
              </span>
              <span className="text-sm font-bold font-mono text-slate-200 block mt-1">
                {multiStartSummary
                  ? `${multiStartSummary.totalStarts} Starts (#${multiStartSummary.bestStartIndex})`
                  : `${fittingResult.iterations} 次`}
              </span>
              <span className="text-[10px] text-emerald-400 mt-0.5 block">
                {fittingResult.freshCalculationVerified ? '✓ Fresh TMM 驗算一致' : '數值收斂'}
              </span>
            </div>
          </div>

          {/* B-spline Diagnostic Card (Strictly separated Raw MSE, Regularization Penalty, Total Objective) */}
          {bsplineDiag && (
            <div className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    B-spline 前處理診斷 ({bsplineDiag.activeKnots ?? 8} Knots)
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Raw MSE 與二階平滑正則化嚴格分離
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg text-center font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block">Raw MSE</span>
                  <span className="text-xs text-cyan-300 font-semibold">
                    {bsplineDiag.rawMse.toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Reg. Penalty</span>
                  <span className="text-xs text-amber-300 font-semibold">
                    {(bsplineDiag.regularizationPenalty ?? 0).toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Objective</span>
                  <span className="text-xs text-emerald-300 font-semibold">
                    {(bsplineDiag.totalObjective ?? bsplineDiag.rawMse).toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Ψ RMSE</span>
                  <span className="text-xs text-slate-300">{bsplineDiag.psiRmse.toFixed(3)}°</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Δ RMSE</span>
                  <span className="text-xs text-slate-300">{bsplineDiag.deltaRmse.toFixed(3)}°</span>
                </div>
              </div>
              {bsplineDiag.knotRefinementHistory && bsplineDiag.knotRefinementHistory.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-slate-400">
                  <span className="text-slate-500">Progressive Knot Stages:</span>
                  {bsplineDiag.knotRefinementHistory.map((st, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                    >
                      {st.knots} knots: Raw MSE={st.rawMse.toFixed(4)}, Reg={st.regularizationPenalty.toFixed(4)}, d={st.thicknessNm.toFixed(2)}nm
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Physical Model Mismatch Alert */}
          {isPhysicalModelMismatch && (
            <div className="pt-4">
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/50 space-y-1">
                <div className="flex items-center space-x-2 text-amber-300 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Physical Model Mismatch 警示</span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  B-spline 數值光學常數能精準吻合實驗光譜，但選定之物理模型在當前振盪子設定下未能充份再現光學常數。
                  建議在【擬合設定】中提升振盪子複雜度 (+1 oscillator) 或切換為 Tauc-Lorentz / Multi-Oscillator 模型。
                </p>
              </div>
            </div>
          )}

          {/* Fitted Parameters Summary Table */}
          <div className="pt-4 space-y-2">
            <span className="font-semibold text-slate-200 block">
              最終擬合參數清單 ({fittingResult.parameters.length} 項參數)
            </span>
            <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="bg-slate-800/90 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2">參數名稱</th>
                    <th className="p-2">初始值</th>
                    <th className="p-2">擬合最佳值</th>
                    <th className="p-2">物理邊界</th>
                    <th className="p-2 text-right">變化量 Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                  {fittingResult.parameters.map((p, idx) => {
                    const diff = p.finalValue - p.initialValue;
                    return (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="p-2 font-sans font-medium text-slate-200">
                          {p.paramName}
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
                            diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-amber-400' : 'text-slate-400'
                          }`}
                        >
                          {diff >= 0 ? '+' : ''}
                          {diff.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions: 3 specific AutoEllipso exports */}
        <div className="px-5 py-3.5 bg-slate-800/80 border-t border-slate-700 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={onExportNk}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center space-x-1.5 shadow-sm transition-colors"
              title="匯出 AutoEllipso_optical_constants.csv (Wavelength, n, k)"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>匯出 n/k</span>
            </button>

            <button
              onClick={onExportFullReport}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 flex items-center space-x-1.5 shadow-sm transition-colors"
              title="匯出 AutoEllipso_fitted_curve.csv (Wavelength, AOI, Psi/Delta Exp, Calc, Residual)"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>匯出光譜曲線</span>
            </button>

            {onExportParametersJson && (
              <button
                onClick={onExportParametersJson}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white flex items-center space-x-1.5 shadow-sm transition-colors"
                title="匯出 AutoEllipso_fitted_parameters.json"
              >
                <Download className="w-3.5 h-3.5" />
                <span>匯出參數 JSON</span>
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
          >
            關閉檢視
          </button>
        </div>
      </div>
    </div>
  );
};
