/**
 * AutoEllipso — Sample Stack Panel (Left Sidebar)
 *
 * Sample Structure Architecture:
 * - Single Layer (DEFAULT): Ambient -> Film -> Substrate
 * - Multi-Layer (OPTIONAL): Ambient -> Layer 1 -> Layer 2 -> ... -> Substrate
 */

import React from 'react';
import {
  Layers,
  Plus,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Disc,
  Layers3,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { Layer, Ambient, Substrate } from '../types/ellipsometry';
import { modelRegistry } from '../modelRegistry/registry';

interface SampleStackPanelProps {
  sampleStructure?: 'single_layer' | 'multi_layer';
  onToggleSampleStructure?: (mode: 'single_layer' | 'multi_layer') => void;
  ambient: Ambient;
  layers: Layer[];
  substrate: Substrate;
  selectedLayerId: string | 'ambient' | 'substrate';
  onSelectLayer: (id: string | 'ambient' | 'substrate') => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onMoveLayerUp: (index: number) => void;
  onMoveLayerDown: (index: number) => void;
}

export const SampleStackPanel: React.FC<SampleStackPanelProps> = ({
  sampleStructure = 'single_layer',
  onToggleSampleStructure,
  ambient,
  layers,
  substrate,
  selectedLayerId,
  onSelectLayer,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onMoveLayerUp,
  onMoveLayerDown,
}) => {
  const isSingleLayer = sampleStructure === 'single_layer';
  const primaryLayer = layers[0] || {
    id: 'layer_primary',
    name: 'Film',
    materialName: 'Dielectric Film',
    thickness: 100.0,
    thicknessMin: 0.1,
    thicknessMax: 5000.0,
    thicknessFit: true,
    modelId: 'cauchy',
    parameters: {},
    color: '#06b6d4',
  };

  return (
    <aside id="stack-panel" className="stack-panel w-72 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none shrink-0">
      {/* 1. Header & Sample Structure Toggle */}
      <div className="p-3 border-b border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              樣品結構 (Sample Structure)
            </span>
          </div>

          {!isSingleLayer && (
            <button
              id="btn-add-layer"
              onClick={onAddLayer}
              className="px-2 py-0.5 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 hover:text-cyan-300 border border-cyan-500/30 rounded text-xs flex items-center space-x-1 transition-colors"
              title="新增一層薄膜"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新增層</span>
            </button>
          )}
        </div>

        {/* Structure Mode Switcher (Single Layer vs Multi-Layer) */}
        <div className="bg-slate-950 p-1 rounded-lg border border-slate-800 flex items-center text-xs">
          <button
            onClick={() => onToggleSampleStructure?.('single_layer')}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center space-x-1.5 transition-all ${
              isSingleLayer
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="單層薄膜反演 (Single Layer Mode - AutoEllipso 預設核心)"
          >
            <Disc className="w-3.5 h-3.5" />
            <span>Single Layer</span>
            <span className="text-[10px] bg-cyan-800/80 text-cyan-200 px-1 rounded ml-1 font-mono">
              Default
            </span>
          </button>
          <button
            onClick={() => onToggleSampleStructure?.('multi_layer')}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center space-x-1.5 transition-all ${
              !isSingleLayer
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="多層光學堆疊模式 (Multi-Layer Stack Mode)"
          >
            <Layers3 className="w-3.5 h-3.5" />
            <span>Multi-Layer</span>
          </button>
        </div>
      </div>

      {/* 2. Layer Stack Diagram / List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Ambient (Incident Medium) */}
        <div
          id="ambient-card"
          onClick={() => onSelectLayer('ambient')}
          className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
            selectedLayerId === 'ambient'
              ? 'bg-cyan-950/40 border-cyan-500/70 text-cyan-100 shadow-sm'
              : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800/80 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">Ambient</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              入射環境
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-slate-400">
            <span>{ambient.name}</span>
            <span className="font-mono text-cyan-300">n={ambient.n.toFixed(3)}</span>
          </div>
        </div>

        {/* Trajectory arrow */}
        <div className="flex justify-center items-center py-0.5">
          <div className="h-3 w-px bg-slate-700 border-l border-dashed border-cyan-500/50" />
        </div>

        {/* SINGLE LAYER MODE: Fixed Ambient -> Film -> Substrate */}
        {isSingleLayer ? (
          <div
            id={`layer-card-${primaryLayer.id}`}
            onClick={() => onSelectLayer(primaryLayer.id)}
            className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
              selectedLayerId === primaryLayer.id
                ? 'bg-cyan-950/60 border-cyan-500 text-cyan-100 shadow-md ring-1 ring-cyan-500/40'
                : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-[11px] flex items-center justify-center font-bold">
                  ★
                </span>
                <span className="font-semibold text-slate-100">Film Layer (反演薄膜)</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 font-mono">
                {modelRegistry.get(primaryLayer.modelId)?.name || primaryLayer.modelId}
              </span>
            </div>

            <div className="mt-2 space-y-1 bg-slate-950/50 p-2 rounded border border-slate-800 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Thickness d:</span>
                <span className="font-mono text-cyan-300 font-semibold">
                  {primaryLayer.thickness.toFixed(2)} nm
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Optical Model:</span>
                <span className="text-slate-200 font-medium">
                  {modelRegistry.get(primaryLayer.modelId)?.name || primaryLayer.modelId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Fitting Status:</span>
                <span className="text-emerald-400 font-mono flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                  <span>d + n(λ) + k(λ) 聯立</span>
                </span>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
              <span>點擊右側面板調整或啟動 AutoFit</span>
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            </div>
          </div>
        ) : (
          /* MULTI-LAYER MODE: Full layer stack management */
          layers.map((layer, index) => {
            const isSelected = selectedLayerId === layer.id;
            const modelDef = modelRegistry.get(layer.modelId);
            const hasFittingParams =
              layer.thicknessFit || Object.values(layer.parameters).some((p) => p.fit);

            return (
              <div
                key={layer.id}
                id={`layer-card-${layer.id}`}
                onClick={() => onSelectLayer(layer.id)}
                className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-indigo-950/60 border-indigo-500 text-indigo-100 shadow-md ring-1 ring-indigo-500/40'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-5 h-5 rounded-full bg-slate-700/80 text-slate-300 font-mono text-[11px] flex items-center justify-center font-bold">
                      {index + 1}
                    </span>
                    <span className="font-semibold text-slate-100">{layer.name}</span>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {hasFittingParams && (
                      <span
                        title="此層有參數開啟自動擬合 [FIT ON]"
                        className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
                      />
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 font-mono">
                      {modelDef?.name || layer.modelId}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">{layer.materialName}</span>
                  <span className="font-mono text-cyan-300 font-medium">
                    {layer.thickness.toFixed(2)} nm
                  </span>
                </div>

                {/* Layer actions */}
                <div
                  className="mt-2 pt-2 border-t border-slate-700/60 flex items-center justify-end space-x-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onMoveLayerUp(index)}
                    disabled={index === 0}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 disabled:opacity-30"
                    title="上移薄膜層"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMoveLayerDown(index)}
                    disabled={index === layers.length - 1}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 disabled:opacity-30"
                    title="下移薄膜層"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDuplicateLayer(layer.id)}
                    className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-700"
                    title="複製此薄膜層"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteLayer(layer.id)}
                    disabled={layers.length <= 1}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-700 disabled:opacity-30"
                    title="刪除此薄膜層"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Trajectory arrow */}
        <div className="flex justify-center items-center py-0.5">
          <div className="h-3 w-px bg-slate-700 border-l border-dashed border-cyan-500/50" />
        </div>

        {/* Substrate */}
        <div
          id="substrate-card"
          onClick={() => onSelectLayer('substrate')}
          className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
            selectedLayerId === 'substrate'
              ? 'bg-cyan-950/40 border-cyan-500/70 text-cyan-100 shadow-sm'
              : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800/80 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">Substrate</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              底材基板
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-slate-400">
            <span>{substrate.name}</span>
            <span className="font-mono text-cyan-300">
              {modelRegistry.get(substrate.modelId)?.name || substrate.modelId}
            </span>
          </div>
        </div>
      </div>

      {/* Footer info */}
      <div className="p-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between bg-slate-950/40">
        <span>模式: {isSingleLayer ? 'Single Layer' : `Multi-Layer (${layers.length} 層)`}</span>
        <span className="font-mono text-cyan-300">
          d = {isSingleLayer ? primaryLayer.thickness.toFixed(1) : layers.reduce((s, l) => s + l.thickness, 0).toFixed(1)} nm
        </span>
      </div>
    </aside>
  );
};
