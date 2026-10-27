import {FitAssessmentSummary} from './FitAssessmentSummary';
import {defaultOpticalExport} from '../fitting/fitPresentation';
import {FitStatisticsPanel,StatisticsWarning,ParameterEstimate} from './FitStatisticsPanel';
import {OpticalModelComparisonPanel} from './OpticalModelComparisonPanel';
/**
 * AutoEllipso — Final Fitting Results & Diagnostics Modal
 *
 * Implements:
 * - Fit adequacy from existing statistics, independently of optimizer convergence
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
}) => {
  if (!isOpen) return null;

  const rawMse = fittingResult.rawMse ?? fittingResult.finalMse;
  const rawRmse = fittingResult.rawRmse ?? fittingResult.finalRmse;
  const psiRmse = fittingResult.psiRmse;
  const deltaRmse = fittingResult.deltaRmse;


  // Extract fitted thickness
  const thicknessParam = fittingResult.parameters.find(
    (p) => p.paramId === 'thickness' || p.paramName.toLowerCase().includes('thickness')
  );
  const finalThickness = thicknessParam ? thicknessParam.finalValue : primaryLayer.thickness;

  const bsplineDiag = fittingResult.bsplineDiagnostic;
  const multiStartSummary = fittingResult.multiStartSummary;
  const isPhysicalModelMismatch = !!fittingResult.opticalModelComparison?.warning;

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
    <div role="dialog" aria-modal="true" aria-label="擬合結果詳細視窗" className="ui1-surface result-modal fixed inset-0 z-50 flex items-center justify-center surface-card backdrop-blur-sm p-4">
      <div className="result-shell surface-card border border-token rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <StatisticsWarning statistics={fittingResult.statistics}/>
        <div className="result-heading p-5 border-b border-token flex items-start justify-between">
          <FitAssessmentSummary result={fittingResult}/>
          <button onClick={onClose} className="tone-muted tone-primary" aria-label="關閉結果">✕</button>
        </div>

        {/* Content Body */}
        <div className="result-body p-5 space-y-4 overflow-y-auto text-xs tone-text divide-y divide-token">
          {fittingResult.weightingWarning&&<p role="alert" className="tone-warn">{fittingResult.weightingWarning}</p>}
          {fittingResult.converged===false&&<p className="tone-warn">未收斂</p>}
          {/* Key Metrics Grid */}
          <div className="result-metrics grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 surface-card rounded-lg border border-token">
              <span className="text-[10px] tone-muted uppercase font-mono block">
                MSE (Woollam)
              </span>
              <span
                className="text-lg font-bold font-mono tone-primary"
              >
                {fittingResult.mseWoollam?.toFixed(4)??'—'}
              </span>
              <span className="text-[10px] tone-muted mt-0.5 block">Raw MSE {rawMse.toFixed(4)} deg² · χ²ᵣ {fittingResult.reducedChiSquare?.toFixed(4)??'—'}</span>
            </div>

            <div className="p-3 surface-card rounded-lg border border-token">
              <span className="text-[10px] tone-muted uppercase font-mono block">
                Ψ / Δ RMSE
              </span>
              <span className="text-sm font-bold font-mono tone-primary block mt-1">
                {psiRmse !== undefined ? `${psiRmse.toFixed(3)}°` : `${rawRmse.toFixed(3)}°`} /{' '}
                {deltaRmse !== undefined ? `${deltaRmse.toFixed(3)}°` : `${rawRmse.toFixed(3)}°`}
              </span>
              <span className="text-[10px] tone-muted mt-0.5 block">
                總 RMSE: {rawRmse.toFixed(4)}°
              </span>
            </div>

            <div className="p-3 surface-card rounded-lg border border-token">
              <span className="text-[10px] tone-muted uppercase font-mono block">
                Fitted Thickness d
              </span>
              <span className="text-lg font-bold font-mono tone-primary">
                {finalThickness.toFixed(2)} <small>nm</small>
              </span>
              <span className="text-[10px] tone-muted mt-0.5 block">薄膜反演最終厚度</span>
            </div>

            <div className="p-3 surface-card rounded-lg border border-token">
              <span className="text-[10px] tone-muted uppercase font-mono block">
                Multi-Start &amp; TMM
              </span>
              <span className="text-sm font-bold font-mono tone-text block mt-1">
                {multiStartSummary
                  ? `${multiStartSummary.totalStarts} Starts (#${multiStartSummary.bestStartIndex})`
                  : `${fittingResult.iterations} 次`}
              </span>
              <span className="text-[10px] tone-ok mt-0.5 block">
                {fittingResult.freshCalculationVerified ? '✓ Fresh TMM 驗算一致' : '數值收斂'}
              </span>
            </div>
          </div>

          {/* B-spline Diagnostic Card (Strictly separated Raw MSE, Regularization Penalty, Total Objective) */}
          {bsplineDiag && (
            <div className="result-diagnostic pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold tone-text flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 tone-primary" />
                  <span>
                    {bsplineDiag.skipped?'自由形式已略過（以下為 Cauchy 診斷）':`B-spline 前處理診斷 (${bsplineDiag.activeKnots ?? 8} Knots)`}
                  </span>
                </span>
                <span className="text-[10px] font-mono tone-muted">
                  Raw MSE 與平滑正則化分離 · 加權目標 {bsplineDiag.weightedTotalObjective?.toFixed(4)??'—'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2.5 surface-card border border-token rounded-lg text-center font-mono">
                <div>
                  <span className="text-[10px] tone-muted block">Raw MSE</span>
                  <span className="text-xs tone-primary font-semibold">
                    {bsplineDiag.rawMse.toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] tone-muted block">Reg. Penalty</span>
                  <span className="text-xs tone-warn font-semibold">
                    {(bsplineDiag.regularizationPenalty ?? 0).toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] tone-muted block">Raw + Reg. 診斷</span>
                  <span className="text-xs tone-ok font-semibold">
                    {(bsplineDiag.totalObjective ?? bsplineDiag.rawMse).toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] tone-muted block">Ψ RMSE</span>
                  <span className="text-xs tone-text">{bsplineDiag.psiRmse.toFixed(3)}°</span>
                </div>
                <div>
                  <span className="text-[10px] tone-muted block">Δ RMSE</span>
                  <span className="text-xs tone-text">{bsplineDiag.deltaRmse.toFixed(3)}°</span>
                </div>
              </div>
              {bsplineDiag.knotRefinementHistory && bsplineDiag.knotRefinementHistory.length > 0 && (
                <div className="knot-history flex flex-wrap items-center gap-1.5 text-[10px] font-mono tone-muted">
                  <span className="tone-muted">Progressive Knot Stages:</span>
                  {bsplineDiag.knotRefinementHistory.map((st, idx) => (
                    <span
                      key={idx}
                      className={`knot-row px-2 py-0.5 rounded surface-card border border-token tone-text ${st.selected?'result-knot-selected':''}`}
                    >
                      {st.knots} knots: {st.skipped?'跳過：'+st.skipReason:'BIC='+st.bic?.toFixed(3)+' · ΔBIC='+(st.deltaBic?.toFixed(3)??'—')+' · M_eff='+st.effectiveParameters+' · '+st.status+(st.selected?' · 最終採用':'')} · Raw MSE={st.rawMse?.toFixed(4)??'—'}, Reg={st.regularizationPenalty?.toFixed(4)??'—'}, d={st.thicknessNm?.toFixed(2)??'—'}nm
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Physical Model Mismatch Alert */}
          {isPhysicalModelMismatch && (
            <div className="pt-4">
              <div className="result-warning p-3 rounded-lg warning-surface border border-token space-y-1">
                <div className="flex items-center space-x-2 tone-warn font-semibold">
                  <AlertTriangle className="w-4 h-4 tone-warn" />
                  <span>Physical Model Mismatch 警示</span>
                </div>
                <p className="text-[11px] tone-warn leading-relaxed">
                  {fittingResult.opticalModelComparison?.warning}
                </p>
              </div>
            </div>
          )}

          <OpticalModelComparisonPanel result={fittingResult}/>
          {/* Fitted Parameters Summary Table */}
          <div className="pt-4 space-y-2">
            <span className="font-semibold tone-text block">
              最終擬合參數清單 ({fittingResult.parameters.length} 項參數)
            </span>
            <div className="max-h-48 overflow-y-auto border border-token rounded-lg">
              <FitStatisticsPanel result={fittingResult}/>
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="surface-card tone-muted sticky top-0">
                  <tr>
                    <th className="p-2">參數名稱</th>
                    <th className="p-2">初始值</th>
                    <th className="p-2">擬合最佳值</th>
                    <th className="p-2">物理邊界</th>
                    <th className="p-2 text-right">變化量 Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-token surface-card">
                  {fittingResult.parameters.map((p, idx) => {
                    const diff = p.finalValue - p.initialValue;
                    return (
                      <tr key={idx} className="result-hover">
                        <td className="p-2 font-sans font-medium tone-text">
                          {p.paramName}
                        </td>
                        <td className="p-2 tone-muted">
                          {p.initialValue.toFixed(4)} {p.unit}
                        </td>
                        <td className="p-2 tone-primary font-bold">
                          <ParameterEstimate result={fittingResult} parameter={p}/>
                        </td>
                        <td className="p-2 tone-muted">
                          [{p.min}, {p.max}]
                        </td>
                        <td
                          className={`p-2 text-right font-semibold ${
                            diff > 0 ? 'tone-ok' : diff < 0 ? 'tone-warn' : 'tone-muted'
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
        <div className="result-footer px-5 py-3.5 surface-card border-t border-token flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={onExportNk}
              className="result-primary px-3 py-1.5 rounded-md text-xs font-semibold surface-card result-hover tone-primary border border-token flex items-center space-x-1.5 shadow-sm transition-colors"
              title="匯出 AutoEllipso_optical_constants.csv (Wavelength, n, k)"
            >
              <Download className="w-3.5 h-3.5 tone-primary" />
              <span>匯出 n/k</span>
            </button>

            <span className="font-mono text-[10px] tone-muted">{defaultOpticalExport(fittingResult).label}</span>
            <button
              onClick={onExportFullReport}
              className="px-3 py-1.5 rounded-md text-xs font-semibold surface-card result-hover tone-ok border border-token flex items-center space-x-1.5 shadow-sm transition-colors"
              title="匯出 AutoEllipso_fitted_curve.csv (Wavelength, AOI, Psi/Delta Exp, Calc, Residual)"
            >
              <Download className="w-3.5 h-3.5 tone-ok" />
              <span>匯出光譜曲線</span>
            </button>

            {onExportParametersJson && (
              <button
                onClick={onExportParametersJson}
                className="px-3 py-1.5 rounded-md text-xs font-semibold surface-card result-hover tone-text flex items-center space-x-1.5 shadow-sm transition-colors"
                title="匯出 AutoEllipso_fitted_parameters.json"
              >
                <Download className="w-3.5 h-3.5" />
                <span>匯出參數 JSON</span>
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs font-medium tone-text result-hover transition-colors"
          >
            關閉檢視
          </button>
        </div>
      </div>
    </div>
  );
};
