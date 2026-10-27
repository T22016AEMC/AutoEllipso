/**
 * Layer Parameters Panel (Right Sidebar)
 * Dynamically renders optical model parameters based strictly on ModelRegistry definitions.
 * Provides controls for Current, Initial, Min, Max, and Fit ON/OFF status.
 */
import React from 'react';
import { Sliders, HelpCircle, Check, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Layer, Ambient, Substrate, ParameterValue } from '../types/ellipsometry';
import { modelRegistry } from '../modelRegistry/registry';
import { materialRegistry } from '../materialRegistry/materialRegistry';

interface LayerParamPanelProps {
  selectedTarget: string | 'ambient' | 'substrate';
  ambient: Ambient;
  layers: Layer[];
  substrate: Substrate;
  onUpdateAmbient: (ambient: Ambient) => void;
  onUpdateLayer: (layer: Layer) => void;
  onUpdateSubstrate: (substrate: Substrate) => void;
  onManualCalculate: () => void;
}

export const LayerParamPanel: React.FC<LayerParamPanelProps> = ({
  selectedTarget,
  ambient,
  layers,
  substrate,
  onUpdateAmbient,
  onUpdateLayer,
  onUpdateSubstrate,
  onManualCalculate,
}) => {
  const [parametersExpanded, setParametersExpanded] = React.useState(false);
  // If Ambient is selected
  if (selectedTarget === 'ambient') {
    return (
      <aside id="parameter-panel" className="ui1-surface parameter-panel w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full select-none shrink-0 overflow-y-auto">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              入射環境介質 (Ambient)
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">環境介質名稱</label>
            <input
              type="text"
              value={ambient.name}
              onChange={(e) => onUpdateAmbient({ ...ambient, name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">折射率 (Refractive Index n)</label>
            <input
              type="number"
              step="0.001"
              min="1.0"
              value={ambient.n}
              onChange={(e) =>
                onUpdateAmbient({ ...ambient, n: parseFloat(e.target.value) || 1.0 })
              }
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">消光係數 (Extinction Coefficient k)</label>
            <input
              type="number"
              step="0.001"
              min="0.0"
              value={ambient.k}
              onChange={(e) =>
                onUpdateAmbient({ ...ambient, k: parseFloat(e.target.value) || 0.0 })
              }
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="pt-2">
            <button
              onClick={onManualCalculate}
              className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-medium text-xs shadow transition-colors"
            >
              更新環境介質並計算
            </button>
          </div>
        </div>
      </aside>
    );
  }

  // If Substrate is selected
  if (selectedTarget === 'substrate') {
    const substrateModels = modelRegistry.getSubstrateModels();
    const currentModel = modelRegistry.get(substrate.modelId);

    const handleSubstrateModelChange = (newModelId: string) => {
      const newParams = modelRegistry.createParameterSet(newModelId);
      onUpdateSubstrate({
        ...substrate,
        modelId: newModelId,
        parameters: newParams,
      });
    };

    const handleSubstrateParamChange = (
      paramId: string,
      field: keyof ParameterValue,
      val: any
    ) => {
      const updatedParams = { ...substrate.parameters };
      updatedParams[paramId] = {
        ...updatedParams[paramId],
        [field]: val,
      };
      onUpdateSubstrate({ ...substrate, parameters: updatedParams });
    };

    return (
      <aside id="parameter-panel" className="ui1-surface parameter-panel w-84 bg-slate-900 border-l border-slate-800 flex flex-col h-full select-none shrink-0 overflow-y-auto">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              基板材料 (Substrate)
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">基板名稱</label>
            <input
              type="text"
              value={substrate.name}
              onChange={(e) => onUpdateSubstrate({ ...substrate, name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">光學模型 (Optical Model)</label>
            <select
              value={substrate.modelId}
              onChange={(e) => handleSubstrateModelChange(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            >
              {substrateModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {currentModel && (
              <p className="mt-1 text-[11px] text-slate-400 italic leading-snug">
                {currentModel.description}
              </p>
            )}
          </div>

          {/* Dynamic substrate parameters if any */}
          {Object.values(substrate.parameters).length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-3">
              <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                模型參數
              </div>
              {Object.values(substrate.parameters).map((param) => (
                <div key={param.id} className="p-2.5 bg-slate-800/60 rounded border border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">
                      {param.name} {param.unit && `(${param.unit})`}
                    </span>
                    <label className="flex items-center space-x-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={param.fit}
                        onChange={(e) =>
                          handleSubstrateParamChange(param.id, 'fit', e.target.checked)
                        }
                        className="rounded border-slate-700 text-cyan-600 focus:ring-0"
                      />
                      <span className={`text-[10px] font-bold ${param.fit ? 'text-emerald-400' : 'text-slate-500'}`}>
                        擬合 FIT
                      </span>
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={param.current}
                      onChange={(e) =>
                        handleSubstrateParamChange(
                          param.id,
                          'current',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={onManualCalculate}
              className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-medium text-xs shadow transition-colors"
            >
              更新基板並重新計算
            </button>
          </div>
        </div>
      </aside>
    );
  }

  // Active layer selection
  const currentLayer = layers.find((l) => l.id === selectedTarget) || layers[0];
  if (!currentLayer) {
    return <aside id="parameter-panel" className="ui1-surface parameter-panel w-84 bg-slate-900 border-l border-slate-800 p-4 text-xs text-slate-400">尚未選取任何薄膜層</aside>;
  }

  const layerModels = modelRegistry.getLayerModels();
  const currentModel = modelRegistry.get(currentLayer.modelId);

  const handleModelChange = (newModelId: string) => {
    const newParams = modelRegistry.createParameterSet(newModelId);
    onUpdateLayer({
      ...currentLayer,
      modelId: newModelId,
      parameters: newParams,
    });
  };

  const handleThicknessChange = (field: keyof Layer, val: any) => {
    onUpdateLayer({
      ...currentLayer,
      [field]: val,
    });
  };

  const handleParamChange = (paramId: string, field: keyof ParameterValue, val: any) => {
    const updatedParams = { ...currentLayer.parameters };
    updatedParams[paramId] = {
      ...updatedParams[paramId],
      [field]: val,
    };
    onUpdateLayer({
      ...currentLayer,
      parameters: updatedParams,
    });
  };

  return (
    <aside id="parameter-panel" className="ui1-surface parameter-panel w-84 bg-slate-900 border-l border-slate-800 flex flex-col h-full select-none shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            薄膜層參數設定 (Parameters)
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4 text-xs">
        {/* Layer identity */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">薄膜層名稱</label>
            <input
              type="text"
              value={currentLayer.name}
              onChange={(e) => handleThicknessChange('name', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1 font-medium">材料種類</label>
            <input
              type="text"
              value={currentLayer.materialName}
              onChange={(e) => handleThicknessChange('materialName', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Quick Material Database Preset */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-slate-400 font-medium">從材料庫載入 (Material DB)</label>
            <span className="text-[10px] text-cyan-400">推薦物理模型與初值</span>
          </div>
          <select
            value=""
            onChange={(e) => {
              const matId = e.target.value;
              if (!matId) return;
              const mat = materialRegistry.get(matId);
              if (!mat) return;
              const newParams = modelRegistry.createParameterSet(mat.defaultModelId);
              for (const [k, val] of Object.entries(mat.defaultParameters)) {
                if (newParams[k]) {
                  newParams[k].current = val;
                  newParams[k].initial = val;
                }
              }
              onUpdateLayer({
                ...currentLayer,
                materialName: mat.name,
                modelId: mat.defaultModelId,
                parameters: newParams,
              });
            }}
            className="w-full bg-slate-800/80 border border-slate-700 rounded px-2.5 py-1.5 text-slate-300 text-xs focus:outline-none focus:border-cyan-500"
          >
            <option value="">-- 套用標準材料基準值 (選填) --</option>
            {materialRegistry.getAll().map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} → {m.defaultModelId}
              </option>
            ))}
          </select>
        </div>

        {/* Optical Model Architecture: Fixed Preprocessing & Final Physical Model */}
        <div className="space-y-3 p-3 bg-slate-800/60 rounded-lg border border-slate-700">
          {/* A. Fixed Preprocessing */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                A. 固定前處理流程 (Fixed Preprocessing)
              </span>
              <span className="text-[10px] bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                固定步驟 / 不可跳過
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 bg-slate-900/90 rounded border border-slate-700/60 flex items-center justify-between">
                <span className="font-mono text-cyan-300">1. Cauchy 0-point</span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/70 px-1.5 py-0.5 rounded border border-emerald-800/60">
                  Fixed
                </span>
              </div>
              <div className="p-2 bg-slate-900/90 rounded border border-slate-700/60 flex items-center justify-between">
                <span className="font-mono text-cyan-300">2. B-spline n/k</span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/70 px-1.5 py-0.5 rounded border border-emerald-800/60">
                  Fixed
                </span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 leading-tight">
              Cauchy 建立透明區初始 baseline；B-spline 解算自由光學常數，再由數值光譜特徵轉換為最終物理模型初值。
            </p>
          </div>

          <div className="h-px bg-slate-700/60" />

          {/* B. Final Physical Optical Model */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">
                B. 最終物理光學模型 (Final Physical Model)
              </label>
              <span className="text-[10px] text-cyan-400 font-medium">使用者選定目標</span>
            </div>
            <select
              aria-label="最終物理光學模型"
              value={currentLayer.modelId}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full bg-slate-900 border border-cyan-700/70 text-cyan-200 font-medium rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-cyan-400 shadow-inner"
            >
              {modelRegistry.getPhysicalModels().map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {currentModel && (
              <div className="mt-1.5 flex items-start space-x-1.5 text-[11px] text-slate-400 bg-slate-900/50 p-2 rounded border border-slate-800">
                <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>{currentModel.description}</span>
              </div>
            )}
          </div>
        </div>

        {/* 1. THICKNESS PARAMETER */}
        <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-slate-100">薄膜厚度 (d)</span>
              <span className="text-slate-400 font-mono text-[11px]">nm</span>
            </div>
            <label className="flex items-center space-x-1 cursor-pointer">
              <input
                type="checkbox"
                checked={currentLayer.thicknessFit}
                onChange={(e) => handleThicknessChange('thicknessFit', e.target.checked)}
                className="rounded border-slate-700 text-cyan-600 focus:ring-0"
              />
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  currentLayer.thicknessFit
                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                    : 'bg-slate-900 text-slate-500 border-slate-800'
                }`}
              >
                擬合 {currentLayer.thicknessFit ? '開啟 (ON)' : '關閉 (OFF)'}
              </span>
            </label>
          </div>

          {/* Current & Slider */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-slate-400 w-14">當前膜厚:</span>
              <input
                type="number"
                step="0.1"
                min={currentLayer.thicknessMin}
                max={currentLayer.thicknessMax}
                value={currentLayer.thickness}
                onChange={(e) =>
                  handleThicknessChange('thickness', parseFloat(e.target.value) || 0)
                }
                onKeyDown={(e) => e.key === 'Enter' && onManualCalculate()}
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
            <input
              type="range"
              min={currentLayer.thicknessMin}
              max={currentLayer.thicknessMax}
              step="0.1"
              value={currentLayer.thickness}
              onChange={(e) =>
                handleThicknessChange('thickness', parseFloat(e.target.value) || 0)
              }
              onMouseUp={onManualCalculate}
              onTouchEnd={onManualCalculate}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* Initial, Min, Max bounds */}
          <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px]">
            <div>
              <span className="text-slate-500 block">初始值</span>
              <input
                type="number"
                value={currentLayer.thicknessInitial}
                onChange={(e) =>
                  handleThicknessChange(
                    'thicknessInitial',
                    parseFloat(e.target.value) || 0
                  )
                }
                className="w-full bg-slate-900 border border-slate-750 rounded px-1.5 py-0.5 text-slate-300 font-mono text-[11px]"
              />
            </div>
            <div>
              <span className="text-slate-500 block">下限 Min</span>
              <input
                type="number"
                value={currentLayer.thicknessMin}
                onChange={(e) =>
                  handleThicknessChange('thicknessMin', parseFloat(e.target.value) || 0)
                }
                className="w-full bg-slate-900 border border-slate-750 rounded px-1.5 py-0.5 text-slate-300 font-mono text-[11px]"
              />
            </div>
            <div>
              <span className="text-slate-500 block">上限 Max</span>
              <input
                type="number"
                value={currentLayer.thicknessMax}
                onChange={(e) =>
                  handleThicknessChange('thicknessMax', parseFloat(e.target.value) || 0)
                }
                className="w-full bg-slate-900 border border-slate-750 rounded px-1.5 py-0.5 text-slate-300 font-mono text-[11px]"
              />
            </div>
          </div>
        </div>

        {/* This disclosure is local UI state; model changes do not reset it. */}
        <div className="model-parameters pt-2 border-t border-slate-800 space-y-3">
          <button type="button" className="parameter-disclosure" aria-expanded={parametersExpanded}
            aria-controls="model-parameter-fields" onClick={() => setParametersExpanded(value => !value)}>
            <span>色散模型參數 (Model Parameters)</span>
            <span className="font-mono">{Object.keys(currentLayer.parameters).length} 個參數</span>
            {parametersExpanded ? <ChevronUp aria-hidden="true" size={18}/> : <ChevronDown aria-hidden="true" size={18}/>}
          </button>
          <div id="model-parameter-fields" className="model-parameter-fields" hidden={!parametersExpanded}>
          {Object.values(currentLayer.parameters).map((param) => {
            const def = currentModel?.parameters.find((p) => p.id === param.id);

            return (
              <div
                key={param.id}
                className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/80 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-slate-100">{param.name}</span>
                    {param.unit && (
                      <span className="text-slate-400 font-mono text-[10px]">
                        [{param.unit}]
                      </span>
                    )}
                  </div>

                  <label className="flex items-center space-x-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={param.fit}
                      onChange={(e) =>
                        handleParamChange(param.id, 'fit', e.target.checked)
                      }
                      className="rounded border-slate-700 text-cyan-600 focus:ring-0"
                    />
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        param.fit
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      擬合 {param.fit ? '開啟 (ON)' : '關閉 (OFF)'}
                    </span>
                  </label>
                </div>

                {def?.description && (
                  <p className="text-[10px] text-slate-400">{def.description}</p>
                )}

                {/* Current Value & Slider */}
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] text-slate-400 w-14">當前值:</span>
                    <input
                      type="number"
                      step={def?.step || 0.001}
                      min={param.min}
                      max={param.max}
                      value={param.current}
                      onChange={(e) =>
                        handleParamChange(
                          param.id,
                          'current',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      onKeyDown={(e) => e.key === 'Enter' && onManualCalculate()}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {param.min !== undefined && param.max !== undefined && (
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={def?.step || 0.001}
                      value={param.current}
                      onChange={(e) =>
                        handleParamChange(
                          param.id,
                          'current',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      onMouseUp={onManualCalculate}
                      onTouchEnd={onManualCalculate}
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                  )}
                </div>

                {/* Initial, Min, Max */}
                <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px]">
                  <div>
                    <span className="text-slate-500 block">初始值</span>
                    <input
                      type="number"
                      value={param.initial}
                      onChange={(e) =>
                        handleParamChange(
                          param.id,
                          'initial',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-750 rounded px-1.5 py-0.5 text-slate-300 font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <span className="text-slate-500 block">下限 Min</span>
                    <input
                      type="number"
                      value={param.min}
                      onChange={(e) =>
                        handleParamChange(
                          param.id,
                          'min',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-750 rounded px-1.5 py-0.5 text-slate-300 font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <span className="text-slate-500 block">上限 Max</span>
                    <input
                      type="number"
                      value={param.max}
                      onChange={(e) =>
                        handleParamChange(
                          param.id,
                          'max',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-750 rounded px-1.5 py-0.5 text-slate-300 font-mono text-[11px]"
                    />
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>

        {/* Re-calculate button */}
        <div className="pt-2">
          <button
            onClick={onManualCalculate}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 rounded font-medium text-xs shadow flex items-center justify-center space-x-1.5 transition-colors"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>套用變更並手動計算</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
