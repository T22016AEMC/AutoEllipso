import {defaultOpticalExport} from '../fitting/fitPresentation';
/**
 * AutoEllipso — Top Application Toolbar
 *
 * Official App Name:
 * AutoEllipso — Automated Spectroscopic Ellipsometry Thin-Film Fitting and Optical Constant Extraction
 */

import React from 'react';
import { APP_VERSION,BUILD_COMMIT } from '../version';
import {
  FolderOpen,
  Save,
  FilePlus,
  Upload,
  Download,
  Zap,
  Square,
  BookOpen,
  ChevronDown,
  Flame,
  SlidersHorizontal,
  FileCode2,
  FileSpreadsheet,
} from 'lucide-react';
import { EllipsometryProject } from '../types/ellipsometry';

interface TopToolbarProps {
  project: EllipsometryProject;
  isFitting: boolean;
  mode: 'automatic' | 'manual';
  onModeChange: (mode: 'automatic' | 'manual') => void;
  onNewProject: (template: 'sio2_multi' | 'sio2' | 'tio2' | 'blank') => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onOpenCsvModal: () => void;
  onExportResults: () => void;
  onExportNk: () => void;
  onExportParametersJson: () => void;
  onAutoFit: () => void;
  onStopFit: () => void;
  onOpenModelLibrary: () => void;
  onOpenTestsModal: () => void;
  onOpenStrategyModal: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  project,
  isFitting,
  mode,
  onModeChange,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onOpenCsvModal,
  onExportResults,
  onExportNk,
  onExportParametersJson,
  onAutoFit,
  onStopFit,
  onOpenModelLibrary,
  onOpenTestsModal,
  onOpenStrategyModal,
}) => {
  const [showNewMenu, setShowNewMenu] = React.useState(false);
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const isAggressive = (project.fittingConfig.fittingStrategy ?? 'aggressive') === 'aggressive';

  return (
    <header className="ui1-surface app-toolbar h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none shrink-0 z-20">
      {/* Left: App Title and Project Indicator */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="brand">
            <h1><img src="/logo/autoellipso-logo.png" alt="AutoEllipso" className="brand-logo" /></h1>
            <p className="brand-version">V{APP_VERSION} · {BUILD_COMMIT.slice(0,7)}</p>
            <p className="brand-project">{project.name}</p>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-800 mx-1" />

        {/* Project I/O Actions */}
        <div className="flex items-center space-x-1">
          {/* New Project Dropdown */}
          <div className="relative">
            <button
              id="btn-new-project"
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1 transition-colors"
              title="建立新專案或載入範本"
            >
              <FilePlus className="w-3.5 h-3.5 text-slate-400" />
              <span>新增專案</span>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </button>

            {showNewMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowNewMenu(false)}
                />
                <div className="absolute left-0 mt-1 w-72 bg-slate-800 border border-slate-700 rounded-md shadow-xl py-1 z-40 text-xs">
                  <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    內建範本與標樣
                  </div>
                  <button
                    onClick={() => {
                      onNewProject('sio2_multi');
                      setShowNewMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200"
                  >
                    <div className="font-medium text-cyan-300 flex items-center space-x-1">
                      <span>100 nm SiO₂ / 矽晶圓 (多角度 65°/70°/75°)</span>
                      <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-1 rounded">
                        Multi-AOI
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      三角度聯立擬合標樣
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onNewProject('sio2');
                      setShowNewMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200"
                  >
                    <div className="font-medium text-slate-100">100 nm SiO₂ / 矽晶圓 (單角度 70°)</div>
                    <div className="text-[11px] text-slate-400">柯西透明氧化層標樣</div>
                  </button>
                  <button
                    onClick={() => {
                      onNewProject('tio2');
                      setShowNewMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200"
                  >
                    <div className="font-medium text-slate-100">35 nm TiO₂ / 矽晶圓 (雙角度 65°/75°)</div>
                    <div className="text-[11px] text-slate-400">高折射率吸收薄膜 Tauc-Lorentz 標樣</div>
                  </button>
                  <div className="border-t border-slate-700 my-1" />
                  <button
                    onClick={() => {
                      onNewProject('blank');
                      setShowNewMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200"
                  >
                    <div className="font-medium text-slate-100">空白自訂專案</div>
                    <div className="text-[11px] text-slate-400">自定義膜層與實驗數據</div>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            id="btn-open-project"
            onClick={onOpenProject}
            className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1 transition-colors"
            title="從 JSON 載入專案"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>開啟專案</span>
          </button>

          <button
            id="btn-save-project"
            onClick={onSaveProject}
            className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1 transition-colors"
            title="儲存專案至 JSON"
          >
            <Save className="w-3.5 h-3.5 text-slate-400" />
            <span>儲存專案</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          <button
            id="btn-import-csv"
            onClick={onOpenCsvModal}
            className="px-2.5 py-1.5 rounded text-xs font-medium text-cyan-300 hover:text-cyan-100 hover:bg-cyan-950/60 border border-cyan-800/60 flex items-center space-x-1 transition-colors"
            title="匯入實驗量測 CSV 數據並進行欄位對應"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>匯入 CSV</span>
          </button>

          {/* Export Dropdown Menu for AutoEllipso outputs */}
          <div className="relative">
            <button
              id="btn-export-menu"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-200 hover:text-cyan-300 hover:bg-slate-800 border border-slate-700/80 flex items-center space-x-1 transition-colors"
              title="匯出 AutoEllipso 光學常數、擬合曲線與參數"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>匯出成果</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showExportMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowExportMenu(false)}
                />
                <div className="absolute left-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-md shadow-xl py-1 z-40 text-xs">
                  <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    AutoEllipso 標準成果匯出
                  </div>
                  <button
                    onClick={() => {
                      onExportNk();
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center space-x-2"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
                    <div>
                      <div className="font-medium text-cyan-300">AutoEllipso_optical_constants.csv</div>
                      <div className="text-[10px] text-slate-400">{project.fittingResult?defaultOpticalExport(project.fittingResult).label:'Wavelength, n, k'}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onExportResults();
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center space-x-2"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    <div>
                      <div className="font-medium text-emerald-300">AutoEllipso_fitted_curve.csv</div>
                      <div className="text-[10px] text-slate-400">Ψ / Δ 實驗與計算曲線與殘差</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onExportParametersJson();
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center space-x-2"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-indigo-400" />
                    <div>
                      <div className="font-medium text-indigo-300">AutoEllipso_fitted_parameters.json</div>
                      <div className="text-[10px] text-slate-400">厚度、Cauchy、B-spline、振盪子、MSE</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Shared navigation stays available while either worker job is running. */}
      <div className="toolbar-fitting-controls flex items-center space-x-2">
        <div className="fitting-mode-tabs" role="tablist" aria-label="擬合模式"
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = mode === 'automatic' ? 'manual' : 'automatic';
            onModeChange(next);
            document.getElementById(`${next}-mode-tab`)?.focus();
          }}>
          <button type="button" id="automatic-mode-tab" role="tab" aria-selected={mode === 'automatic'}
            aria-controls="automatic-mode-panel" tabIndex={mode === 'automatic' ? 0 : -1}
            onClick={() => onModeChange('automatic')}>自動擬合</button>
          <button type="button" id="manual-mode-tab" role="tab" aria-selected={mode === 'manual'}
            aria-controls="manual-mode-panel" tabIndex={mode === 'manual' ? 0 : -1}
            onClick={() => onModeChange('manual')}>手動擬合</button>
        </div>

        {/* Strategy & Options Button */}
        <button
          id="btn-fitting-strategy"
          onClick={onOpenStrategyModal}
          disabled={isFitting}
          className={`px-2.5 py-1.5 rounded-md text-xs font-semibold border flex items-center space-x-1.5 shadow-sm transition-all ${
            isAggressive
              ? 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border-rose-800/80'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
          }`}
          title="設定樣品結構 (Single Layer 預設)、Adaptive B-spline 節點與物理模型"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-rose-400" />
          <span>擬合設定</span>
          <span
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
              isAggressive ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-700 text-slate-300'
            }`}
          >
            {isAggressive ? 'AGGRESSIVE' : 'STD'}
          </span>
        </button>

        {/* Auto Fit / Stop Buttons */}
        {mode === 'automatic' && (!isFitting ? (
          <button
            id="btn-auto-fit"
            onClick={onAutoFit}
            className={`px-4 py-1.5 rounded-md text-xs font-bold text-white shadow-md flex items-center space-x-1.5 transition-all ${
              isAggressive
                ? 'bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-500 hover:to-orange-400'
                : 'bg-cyan-600 hover:bg-cyan-500'
            }`}
            title="啟動 AutoEllipso 嚴格擬合流程 (Cauchy → B-spline → Joint Physical Optimizer)"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>啟動 AutoEllipso 擬合</span>
          </button>
        ) : (
          <button
            id="btn-stop-fit"
            onClick={onStopFit}
            className="px-4 py-1.5 rounded-md text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md flex items-center space-x-1.5 animate-pulse transition-colors"
            title="中止目前擬合程序"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>中止擬合</span>
          </button>
        ))}

        <div className="toolbar-auxiliary">
        {/* Auxiliary Modals */}
        <button
          id="btn-model-library"
          onClick={onOpenModelLibrary}
          disabled={isFitting}
          className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80 flex items-center space-x-1 transition-colors"
          title="瀏覽材料光學常數資料庫 (Si, SiO2, TiO2, Au...)"
        >
          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
          <span>光學資料庫</span>
        </button>

        <button
          id="btn-unit-tests"
          onClick={onOpenTestsModal}
          disabled={isFitting}
          className="px-2.5 py-1.5 rounded text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-emerald-800/60 flex items-center space-x-1 transition-colors"
          title="執行 AutoEllipso 物理求解器與合成反演測試"
        >
          <span>單元測試</span>
        </button>
        </div>
      </div>
    </header>
  );
};
