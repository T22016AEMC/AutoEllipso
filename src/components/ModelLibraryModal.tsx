import React, { useState, useMemo } from 'react';
import { BookOpen, X, CheckCircle2, Compass, Info, Database } from 'lucide-react';
import { modelRegistry } from '../modelRegistry/registry';
import { materialRegistry } from '../materialRegistry/materialRegistry';

interface ModelLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModelLibraryModal: React.FC<ModelLibraryModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'models' | 'materials'>('models');
  const [selectedModelId, setSelectedModelId] = useState<string>('gaussian');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('mat_sio2');

  const allModels = useMemo(() => modelRegistry.getAll(), []);
  const allMaterials = useMemo(() => materialRegistry.getAll(), []);

  const currentModel = useMemo(() => {
    return modelRegistry.get(selectedModelId) || allModels[0];
  }, [selectedModelId, allModels]);

  const currentMaterial = useMemo(() => {
    return materialRegistry.get(selectedMaterialId) || allMaterials[0];
  }, [selectedMaterialId, allMaterials]);

  // Compute live preview dispersion curves n(λ) and k(λ) across 200 - 1000 nm for the selected model
  const dispersionPreviewData = useMemo(() => {
    if (!currentModel) return [];
    const defaultParams: Record<string, number> = {};
    for (const p of currentModel.parameters) {
      defaultParams[p.id] = p.defaultValue;
    }

    const points: { lambda: number; n: number; k: number }[] = [];
    const minW = Math.max(200, currentModel.validRange?.minWavelengthNm || 200);
    const maxW = Math.min(1000, currentModel.validRange?.maxWavelengthNm || 1000);
    const step = (maxW - minW) / 40;

    for (let w = minW; w <= maxW; w += step) {
      try {
        const opt = currentModel.calculate(w, defaultParams);
        points.push({
          lambda: Math.round(w),
          n: Number(opt.n.toFixed(4)),
          k: Number(opt.k.toFixed(4)),
        });
      } catch {
        // Handle boundary conditions
      }
    }
    return points;
  }, [currentModel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
                <span>光學模型與材料資料庫</span>
                <span className="text-[11px] font-normal text-slate-400 font-mono">
                  Optical Model & Material Database
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                徹底解耦光學數學色散方程 (Model Database) 與實體薄膜化學組成 (Material Database)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Tab switch */}
            <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-slate-700 text-xs">
              <button
                onClick={() => setActiveTab('models')}
                className={`px-3 py-1 rounded-md flex items-center space-x-1.5 transition-colors ${
                  activeTab === 'models'
                    ? 'bg-cyan-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>光學模型資料庫 ({allModels.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('materials')}
                className={`px-3 py-1 rounded-md flex items-center space-x-1.5 transition-colors ${
                  activeTab === 'materials'
                    ? 'bg-cyan-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>物理材料資料庫 ({allMaterials.length})</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {activeTab === 'models' ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Models list */}
            <div className="w-64 border-r border-slate-800 bg-slate-950/40 p-2 space-y-1 overflow-y-auto shrink-0">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                獨立光學模型 Registry ({allModels.length})
              </div>
              {allModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModelId(m.id)}
                  className={`w-full text-left p-2.5 rounded-lg transition-colors flex flex-col ${
                    selectedModelId === m.id
                      ? 'bg-cyan-950/70 border border-cyan-800/80 text-cyan-100 ring-1 ring-cyan-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs">{m.name}</span>
                    {m.fitSupported && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="可自動擬合" />
                    )}
                  </div>
                  <div className="flex items-center space-x-1.5 mt-0.5 text-[10px] text-slate-400 truncate">
                    <span className="capitalize">{m.type || m.category}</span>
                    <span>•</span>
                    <span>v{m.version || '1.0'}</span>
                    <span>•</span>
                    <span>{m.parameters.length} 參數</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Selected Model Details */}
            {currentModel && (
              <div className="flex-1 p-5 overflow-y-auto space-y-4">
                {/* Title & Badges */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-bold text-slate-100">{currentModel.name}</h3>
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-cyan-300">
                        ID: {currentModel.id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-300">
                        版本: v{currentModel.version || '1.0.0'}
                      </span>
                      {currentModel.fitSupported ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 font-mono text-[10px] text-emerald-400 flex items-center space-x-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>可自動擬合 (Available for Fitting)</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                          文獻查表固定 (Fixed)
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-slate-300 text-xs leading-relaxed max-w-3xl">
                      {currentModel.description}
                    </p>
                  </div>
                </div>

                {/* Valid Range & Solver Status */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center space-x-2">
                    <Info className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                        有效光譜波長範圍 (Valid Spectral Range)
                      </span>
                      <span className="font-mono text-slate-200">
                        {currentModel.validRange?.minWavelengthNm || 200} nm ~{' '}
                        {currentModel.validRange?.maxWavelengthNm || 2500} nm
                        {currentModel.validRange?.minEnergyEv && (
                          <span className="text-slate-400 text-[11px] ml-1">
                            ({currentModel.validRange.minEnergyEv} eV ~{' '}
                            {currentModel.validRange.maxEnergyEv} eV)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                        光學解算器接通狀態 (Solver Integration)
                      </span>
                      <span className="font-mono text-emerald-400 text-xs">
                        實時驅動 TMM 薄膜求解器 (Active)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Formula & Equation */}
                {(currentModel.equation || currentModel.equationDoc) && (
                  <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs">
                    <span className="text-slate-400 block mb-1 text-[10px] font-sans font-semibold uppercase tracking-wider">
                      物理色散方程式 (Physical Dispersion Formulation):
                    </span>
                    <div className="text-cyan-300 overflow-x-auto whitespace-pre-wrap py-1 text-xs">
                      {currentModel.equation || currentModel.equationDoc}
                    </div>
                  </div>
                )}

                {/* Live Dispersion Curve Preview */}
                {dispersionPreviewData.length > 0 && (
                  <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                        預設參數下的色散曲線預覽 (n, k Spectrum Preview: 200 - 1000 nm)
                      </span>
                      <div className="flex items-center space-x-3 text-[11px] font-mono">
                        <span className="flex items-center space-x-1">
                          <span className="w-2.5 h-1 bg-cyan-400 rounded-full inline-block" />
                          <span className="text-cyan-300">折射率 n(λ)</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span className="w-2.5 h-1 bg-amber-400 rounded-full inline-block" />
                          <span className="text-amber-300">消光係數 k(λ)</span>
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-5 gap-2 text-[10px] font-mono bg-slate-900/60 p-2.5 rounded border border-slate-800">
                      {dispersionPreviewData
                        .filter((_, idx) => idx % 8 === 0)
                        .map((pt) => (
                          <div key={pt.lambda} className="p-1 rounded bg-slate-800/40 text-center">
                            <div className="text-slate-400">{pt.lambda} nm</div>
                            <div className="text-cyan-300">n={pt.n.toFixed(3)}</div>
                            <div className="text-amber-300">k={pt.k.toFixed(3)}</div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Parameters Table */}
                <div>
                  <h4 className="font-semibold text-slate-200 text-xs mb-2 uppercase tracking-wider">
                    光學模型參數定義與物理邊界範圍 (Parameter Definitions & Bounds)
                  </h4>
                  <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950">
                    <table className="w-full text-left font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-sans text-[10px]">
                          <th className="p-2.5">符號</th>
                          <th className="p-2.5">參數名稱</th>
                          <th className="p-2.5">單位</th>
                          <th className="p-2.5">預設值</th>
                          <th className="p-2.5">邊界範圍 [Min, Max]</th>
                          <th className="p-2.5">擬合支援</th>
                          <th className="p-2.5">物理意義說明</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {currentModel.parameters.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-3 text-center text-slate-500 font-sans">
                              此模型為經驗文獻查表 (Tabulated Reference)，無浮動色散擬合參數。
                            </td>
                          </tr>
                        ) : (
                          currentModel.parameters.map((p) => (
                            <tr key={p.id} className="hover:bg-slate-800/30">
                              <td className="p-2.5 font-bold text-cyan-300">{p.symbol}</td>
                              <td className="p-2.5 font-sans text-slate-200">{p.name}</td>
                              <td className="p-2.5 text-slate-400">{p.unit || '-'}</td>
                              <td className="p-2.5 text-emerald-400 font-bold">{p.defaultValue}</td>
                              <td className="p-2.5 text-slate-400">
                                [{p.min}, {p.max}]
                              </td>
                              <td className="p-2.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    p.fitSupported !== false
                                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {p.fitSupported !== false ? 'YES' : 'NO'}
                                </span>
                              </td>
                              <td className="p-2.5 font-sans text-slate-400 max-w-xs text-[10px]">
                                {p.description}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Scientific Reference Citation */}
                {currentModel.reference && (
                  <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/60 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300 block mb-0.5">
                      學術文獻引用出處 (Scientific Citation):
                    </span>
                    <span className="font-mono">{currentModel.reference}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Materials Database Browser */
          <div className="flex-1 flex overflow-hidden">
            {/* Material List */}
            <div className="w-72 border-r border-slate-800 bg-slate-950/40 p-2 space-y-1 overflow-y-auto shrink-0">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                物理材料資料庫 ({allMaterials.length})
              </div>
              {allMaterials.map((mat) => (
                <button
                  key={mat.id}
                  onClick={() => setSelectedMaterialId(mat.id)}
                  className={`w-full text-left p-2.5 rounded-lg transition-colors flex flex-col ${
                    selectedMaterialId === mat.id
                      ? 'bg-cyan-950/70 border border-cyan-800/80 text-cyan-100 ring-1 ring-cyan-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <span className="font-semibold text-xs">{mat.name}</span>
                  <div className="flex items-center space-x-1.5 mt-0.5 text-[10px] text-slate-400 truncate">
                    <span className="capitalize">{mat.category}</span>
                    <span>•</span>
                    <span className="font-mono text-cyan-300">預設模型: {mat.defaultModelId}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Selected Material Details */}
            {currentMaterial && (
              <div className="flex-1 p-5 overflow-y-auto space-y-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-base font-bold text-slate-100">{currentMaterial.name}</h3>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-cyan-300">
                      ID: {currentMaterial.id}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono text-[10px] capitalize">
                      {currentMaterial.category}
                    </span>
                  </div>
                  <p className="mt-1.5 text-slate-300 text-xs leading-relaxed max-w-3xl">
                    {currentMaterial.description}
                  </p>
                </div>

                {/* Default Optical Model Connection */}
                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      推薦標準光學色散模型 (Recommended Optical Model)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-200 font-mono text-xs border border-cyan-700/60">
                      {currentMaterial.defaultModelId}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    此材料在工業與文獻量測中最常使用的物理模型。薄膜層選取此材料後，仍可自由切換其他光學模型（例如改為
                    Gaussian 或 Sellmeier）。
                  </p>
                </div>

                {/* Default Parameter Baselines */}
                <div>
                  <h4 className="font-semibold text-slate-200 text-xs mb-2 uppercase tracking-wider">
                    標準文獻參考參數基準值 (Literature Parameter Baselines)
                  </h4>
                  <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950">
                    <table className="w-full text-left font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-sans text-[10px]">
                          <th className="p-2.5">參數名稱</th>
                          <th className="p-2.5">標準文獻數值</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {Object.entries(currentMaterial.defaultParameters).length === 0 ? (
                          <tr>
                            <td colSpan={2} className="p-3 text-center text-slate-500 font-sans">
                              查表量測型材料，無獨立浮動參數。
                            </td>
                          </tr>
                        ) : (
                          Object.entries(currentMaterial.defaultParameters).map(([k, val]) => (
                            <tr key={k} className="hover:bg-slate-800/30">
                              <td className="p-2.5 font-bold text-cyan-300">{k}</td>
                              <td className="p-2.5 text-emerald-400 font-bold">{val}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Valid Spectral Range */}
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs flex items-center space-x-2">
                  <Info className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                      適用光譜波長範圍 (Valid Wavelength Range)
                    </span>
                    <span className="font-mono text-slate-200">
                      {currentMaterial.validRange.minWavelengthNm} nm ~{' '}
                      {currentMaterial.validRange.maxWavelengthNm} nm
                    </span>
                  </div>
                </div>

                {/* Scientific Reference Citation */}
                {currentMaterial.reference && (
                  <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/60 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300 block mb-0.5">
                      文獻數據來源出處 (Literature Citation):
                    </span>
                    <span className="font-mono">{currentMaterial.reference}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 flex justify-between items-center bg-slate-950/60 text-xs">
          <div className="text-slate-400 text-[11px]">
            Model Registry 與 Material Database 完全解耦，支援動態擴充自訂模型。
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
