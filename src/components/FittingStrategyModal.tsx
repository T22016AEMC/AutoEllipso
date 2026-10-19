/**
 * AutoEllipso — Fitting Strategy & Configuration Modal
 *
 * Implements full user control for AutoEllipso:
 * - Sample Structure: Single Layer (Default) vs Multi-Layer
 * - Target Physical Model: Gaussian, Lorentz, Tauc-Lorentz, Drude, Automatic (No Cauchy/B-spline here!)
 * - Adaptive B-spline Knots: 8, 12, 16, 20
 * - Thickness Search Grid: Min (0.1) ~ Max (5000) nm
 * - Fitting Strategy: Standard vs Aggressive
 * - Multi-Start Joint Optimization toggle
 * - Target Raw MSE threshold (Default 10.0)
 */

import React from 'react';
import {
  SlidersHorizontal,
  Flame,
  Zap,
  Disc,
  Layers3,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { FittingConfig } from '../types/ellipsometry';

interface FittingStrategyModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: FittingConfig;
  onUpdateConfig: (config: FittingConfig) => void;
  onStartFit: () => void;
  isFitting: boolean;
}

export const FittingStrategyModal: React.FC<FittingStrategyModalProps> = ({
  isOpen,
  onClose,
  config,
  onUpdateConfig,
  onStartFit,
  isFitting,
}) => {
  if (!isOpen) return null;

  const sampleStructure = config.sampleStructure ?? 'single_layer';
  const mode = config.fittingStrategy || 'aggressive';
  const targetMse = config.targetMse ?? 10.0;
  const maxOscillators = config.maxOscillators ?? 3;
  const knotCount = config.knotCount ?? (mode === 'aggressive' ? 12 : 8);
  const minThickness = config.minThickness ?? 0.1;
  const maxThickness = config.maxThickness ?? 5000.0;
  const enableMultiStart = config.enableMultiStart ?? true;
  const enablePhysicalConstraints = config.enablePhysicalConstraints ?? true;
  const psiWeight = config.psiWeight ?? 1.0;
  const deltaWeight = config.deltaWeight ?? 1.0;
  const finalModel = config.finalPhysicalModelSelection ?? 'auto';

  const handleResetDefaults = () => {
    onUpdateConfig({
      ...config,
      sampleStructure: 'single_layer',
      fittingStrategy: 'aggressive',
      targetMse: 10.0,
      maxOscillators: 3,
      knotCount: 12,
      minThickness: 0.1,
      maxThickness: 5000.0,
      enableMultiStart: true,
      enableAdaptiveModel: true,
      enablePhysicalConstraints: true,
      psiWeight: 1.0,
      deltaWeight: 1.0,
      finalPhysicalModelSelection: 'auto',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <span>AutoEllipso 擬合設定與樣品結構</span>
                {mode === 'aggressive' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center space-x-1">
                    <Flame className="w-3 h-3 text-rose-400" />
                    <span>AGGRESSIVE FIT</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-700 text-slate-300 border border-slate-600">
                    STANDARD FIT
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                單層反演優先、固定前處理 (Cauchy → B-spline) 與全域厚度多起點聯立最佳化
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-200 divide-y divide-slate-800">
          {/* 1. Sample Structure Switch */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span>樣品結構 (Sample Structure)</span>
              <span className="text-[10px] text-cyan-400 font-mono">
                {sampleStructure === 'single_layer' ? '★ Single Layer 模式' : 'Multi-Layer 模式'}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`p-3 rounded-lg border cursor-pointer flex flex-col space-y-1 transition-all ${
                  sampleStructure === 'single_layer'
                    ? 'bg-cyan-950/50 border-cyan-500 text-cyan-100 ring-1 ring-cyan-500/40'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center space-x-2 font-semibold">
                  <input
                    type="radio"
                    name="sampleStructure"
                    checked={sampleStructure === 'single_layer'}
                    onChange={() => onUpdateConfig({ ...config, sampleStructure: 'single_layer' })}
                    className="text-cyan-500 focus:ring-0"
                  />
                  <span className="flex items-center space-x-1.5">
                    <Disc className="w-3.5 h-3.5 text-cyan-400" />
                    <span>○ Single Layer (預設推薦)</span>
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 pl-5">
                  Ambient → Film → Substrate。聚焦於單一未知薄膜之 Thickness 與 n(λ), k(λ) 聯立反演。
                </span>
              </label>

              <label
                className={`p-3 rounded-lg border cursor-pointer flex flex-col space-y-1 transition-all ${
                  sampleStructure === 'multi_layer'
                    ? 'bg-indigo-950/50 border-indigo-500 text-indigo-100 ring-1 ring-indigo-500/40'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center space-x-2 font-semibold">
                  <input
                    type="radio"
                    name="sampleStructure"
                    checked={sampleStructure === 'multi_layer'}
                    onChange={() => onUpdateConfig({ ...config, sampleStructure: 'multi_layer' })}
                    className="text-indigo-500 focus:ring-0"
                  />
                  <span className="flex items-center space-x-1.5">
                    <Layers3 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>● Multi-Layer (多層堆疊)</span>
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 pl-5">
                  Ambient → Layer 1 → Layer 2 → ... → Substrate。啟用多層膜傳遞矩陣進階管理。
                </span>
              </label>
            </div>
          </div>

          {/* 2. Target Physical Model Selection (No Cauchy or B-spline here!) */}
          <div className="pt-4 space-y-2">
            <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span>目標物理模型 (Physical Model Selection)</span>
              <span className="text-[10px] text-slate-400 font-mono">
                前處理永遠固定為 Cauchy → B-spline
              </span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: 'auto', name: 'Automatic (自動比對)', desc: '比對 Gaussian / Lorentz / TL / Drude' },
                { id: 'gaussian', name: 'Gaussian (1~3)', desc: '無序半導體/介電質吸收態' },
                { id: 'lorentz', name: 'Lorentz (1~3)', desc: '束縛電子/晶體共振態' },
                { id: 'tauc_lorentz', name: 'Tauc-Lorentz (1~3)', desc: '非晶帶邊 (Eg)' },
                { id: 'drude', name: 'Drude', desc: '金屬/自由載子傳導' },
              ].map((mItem) => (
                <button
                  key={mItem.id}
                  onClick={() => onUpdateConfig({ ...config, finalPhysicalModelSelection: mItem.id })}
                  className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-all ${
                    finalModel === mItem.id
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 ring-1 ring-cyan-500/30'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <span className="font-semibold text-[11px] text-slate-200">{mItem.name}</span>
                  <span className="text-[10px] text-slate-400 mt-1">{mItem.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Adaptive B-spline Knots & Thickness Range */}
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                <span>Adaptive B-spline 節點數</span>
                <span className="text-cyan-400 font-mono text-[11px]">{knotCount} Knots</span>
              </label>
              <select
                value={knotCount}
                onChange={(e) =>
                  onUpdateConfig({ ...config, knotCount: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value={8}>8 Knots (Standard 標準)</option>
                <option value={12}>12 Knots (Standard / Aggressive)</option>
                <option value={16}>16 Knots (Aggressive 高解析度)</option>
                <option value={20}>20 Knots (Aggressive 上限)</option>
              </select>
              <span className="text-[10px] text-slate-500 mt-1 block">
                動態自適應對齊實驗光譜波長範圍
              </span>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                <span>厚度搜尋下限 (Min d)</span>
                <span className="text-slate-400 font-mono text-[11px]">{minThickness} nm</span>
              </label>
              <input
                type="number"
                step="0.5"
                min="0.05"
                max="100.0"
                value={minThickness}
                onChange={(e) =>
                  onUpdateConfig({ ...config, minThickness: Math.max(0.05, parseFloat(e.target.value) || 0.1) })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">全域搜尋最小膜厚</span>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                <span>厚度搜尋上限 (Max d)</span>
                <span className="text-slate-400 font-mono text-[11px]">{maxThickness} nm</span>
              </label>
              <input
                type="number"
                step="50"
                min="100.0"
                max="10000.0"
                value={maxThickness}
                onChange={(e) =>
                  onUpdateConfig({ ...config, maxThickness: Math.min(10000.0, parseFloat(e.target.value) || 5000.0) })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">全域搜尋最大膜厚 (上限 5000 nm)</span>
            </div>
          </div>

          {/* 4. Strategy Mode & Multi-Start */}
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                擬合運行策略 (Fitting Strategy)
              </label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  onClick={() => onUpdateConfig({ ...config, fittingStrategy: 'standard' })}
                  className={`p-2 rounded border text-left ${
                    mode === 'standard'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-xs">Standard Fit</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">8 步標準收斂</div>
                </button>
                <button
                  onClick={() => onUpdateConfig({ ...config, fittingStrategy: 'aggressive' })}
                  className={`p-2 rounded border text-left ${
                    mode === 'aggressive'
                      ? 'bg-rose-950/60 border-rose-500 text-rose-200'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-xs flex items-center space-x-1">
                    <Flame className="w-3 h-3 text-rose-400" />
                    <span>Aggressive Fit</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">強制深度尋優 (Top 5 Multi-Start)</div>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                <span>Target MSE 目標門檻</span>
                <span className="text-cyan-400 font-mono text-[11px]">&lt; {targetMse.toFixed(1)}</span>
              </label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                max="50.0"
                value={targetMse}
                onChange={(e) =>
                  onUpdateConfig({ ...config, targetMse: Math.max(0.1, parseFloat(e.target.value) || 10.0) })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                只有 Raw MSE &lt; 此值時方判定為 TARGET ACHIEVED
              </span>
            </div>
          </div>

          <label className="block pt-4 text-xs text-slate-300">擬合權重
            <select aria-label="擬合權重" value={config.fitWeighting} onChange={e=>onUpdateConfig({...config,fitWeighting:e.target.value as FittingConfig['fitWeighting']})}
              className="block w-full mt-1 bg-slate-800 border border-slate-700 rounded px-3 py-1.5">
              <option value="standard_deviation">依量測不確定度 σ（Woollam 標準，建議）</option>
              <option value="uniform">均勻權重</option><option value="psi_dominant">Ψ 優先</option>
            </select>
          </label>
          {/* 5. Switches: Multi-Start & Physical Constraints */}
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center space-x-2.5 p-2.5 bg-slate-800/50 border border-slate-700/80 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={enableMultiStart}
                onChange={(e) => onUpdateConfig({ ...config, enableMultiStart: e.target.checked })}
                className="rounded text-cyan-500 focus:ring-0"
              />
              <div>
                <div className="font-medium text-slate-200 text-xs">Top 5 Multi-Start 聯立尋優</div>
                <div className="text-[10px] text-slate-400">厚度候選點結合振盪子參數微擾，杜絕局部極小值</div>
              </div>
            </label>

            <label className="flex items-center space-x-2.5 p-2.5 bg-slate-800/50 border border-slate-700/80 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={enablePhysicalConstraints}
                onChange={(e) =>
                  onUpdateConfig({ ...config, enablePhysicalConstraints: e.target.checked })
                }
                className="rounded text-cyan-500 focus:ring-0"
              />
              <div>
                <div className="font-medium text-slate-200 text-xs">物理邊界嚴格約束</div>
                <div className="text-[10px] text-slate-400">保證 n ≥ 1.0, k ≥ 0.0, d &gt; 0, E₀ &gt; Eg</div>
              </div>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-800/80 border-t border-slate-700 flex items-center justify-between">
          <button
            onClick={handleResetDefaults}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢復 AutoEllipso 預設值</span>
          </button>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              關閉
            </button>
            <button
              onClick={() => {
                onClose();
                onStartFit();
              }}
              disabled={isFitting}
              className={`px-5 py-1.5 rounded-md text-xs font-bold text-white shadow-lg flex items-center space-x-1.5 transition-all ${
                mode === 'aggressive'
                  ? 'bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-500 hover:to-orange-400'
                  : 'bg-cyan-600 hover:bg-cyan-500'
              }`}
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>{mode === 'aggressive' ? '立即執行強制擬合' : '立即執行標準擬合'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
