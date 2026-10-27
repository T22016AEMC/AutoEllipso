import {defaultOpticalExport} from './fitting/fitPresentation';
/**
 * Thin-Film Ellipsometry Fitting Tool - Main Application
 * Scientific workstation uniting Optical Models, Multilayer TMM Solvers,
 * Manual Parameter Tuning, and Bounded Levenberg-Marquardt Auto-Fitting.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  EllipsometryProject,
  Layer,
  Ambient,
  Substrate,
  ExperimentDataset,
  VisualizationSettings,
} from './types/ellipsometry';
import {
  createSiO2OnSiProject,
  createMultiAoiSiO2OnSiProject,
  createTiO2OnSiProject,
  createBlankProject,
} from './data/defaultProjects';
import { calculateSpectrum } from './solver/calculator';
import {
  computeResidualMetrics,
  computeMultiAoiResidualMetrics,
  ResidualMetrics,
  MultiAoiResidualMetrics,
} from './fitting/residual';
import { runAutoFit } from './fitting/engine';
import { runAutomatedEllipsometryFit, WorkflowProgress } from './fitting/autoWorkflow';
import { modelRegistry } from './modelRegistry/registry';
import {
  exportProjectJson,
  exportResultsCsv,
  exportOpticalConstantsCsv,
  exportFittedCurveCsv,
  exportFittedParametersJson,
  exportFullFitResultCsv,
  importProjectJson,
} from './data/export';

// Components
import { TopToolbar } from './components/TopToolbar';
import { SampleStackPanel } from './components/SampleStackPanel';
import { VisualizerPanel } from './components/VisualizerPanel';
import { LayerParamPanel } from './components/LayerParamPanel';
import { FittingStatusBottomBar } from './components/FittingStatusBottomBar';
import { CsvImportModal } from './components/CsvImportModal';
import { ModelLibraryModal } from './components/ModelLibraryModal';
import { UnitTestsModal } from './components/UnitTestsModal';
import { FittingStrategyModal } from './components/FittingStrategyModal';
import { FinalFitResultModal } from './components/FinalFitResultModal';
const ExpertFittingPanel = React.lazy(() => import('./components/ExpertFittingPanel').then(m=>({default:m.ExpertFittingPanel})));
import { useBrowserCompute } from './hooks/useBrowserCompute';
import { APP_VERSION, BUILD_COMMIT } from './version';
import { downloadValidationReport } from './data/validationReport';
import type { Progress } from './workers/protocol';

export default function App() {
  // Initialize with standard 100 nm SiO2 on Si benchmark sample
  const compute = useBrowserCompute(() => location.hash==='#empty'?createBlankProject():createSiO2OnSiProject());
  const { project, setProject } = compute;
  const importSequence = useRef(0);
  const automaticBusy = useRef(false);

  // Currently selected layer/ambient/substrate in the sample stack
  const [selectedTarget, setSelectedTarget] = useState<string | 'ambient' | 'substrate'>(
    () => project.layers[0]?.id || 'layer_sio2'
  );

  // Modals state
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const [testsModalOpen, setTestsModalOpen] = useState(false);
  const [strategyModalOpen, setStrategyModalOpen] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const manualForwardError=compute.error;

  // Optimizer running state
  const [isFitting, setIsFitting] = useState(false);
  const [currentIter, setCurrentIter] = useState(0);
  const [liveCost, setLiveCost] = useState(0);
  const [prevCost, setPrevCost] = useState<number | null>(null);
  const [liveParams, setLiveParams] = useState<{ name: string; value: number }[]>([]);
  const [paramHistory, setParamHistory] = useState<{ [name: string]: number[] }>({});
  const [workflowProgress, setWorkflowProgress] = useState<WorkflowProgress | null>(null);
  const [pipelineData, setPipelineData] = useState<any>(null);
  const [finalOpticalConstants, setFinalOpticalConstants] = useState<{ wavelength: number; n: number; k: number }[]>([]);
  const shouldStopRef = useRef<boolean>(false);

  // Hidden file input for opening project JSON
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate current residual metrics (with Multi-AOI support)
  const residualMetrics: MultiAoiResidualMetrics = useMemo(() => {
    if (!project.experimentData || project.experimentData.points.length === 0) {
      return {
        mse: 0,
        rmse: 0,
        rawMse: 0,
        rawRmse: 0,
        weightedMse: 0,
        weightedRmse: 0,
        chiSquare: 0,dof:1,underdetermined:true,mseWoollam:0,reducedChiSquare:0,weightingMode:'uniform',
        psiMse: 0,
        deltaMse: 0,
        totalPoints: 0,
        fittingMode: 'single_aoi',
        selectedAois: [],
        perAoi: {},
      };
    }
    return computeMultiAoiResidualMetrics(
      project.experimentData.points,
      project.fittingConfig.activeFitAois,
      project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,project.fittingResult?.numParameters??0
    );
  }, [project.experimentData, project.fittingConfig, project.fittingResult]);

  // Recalculate optical spectrum with current parameter values (Manual Mode)
  const handleManualCalculate = () => compute.refresh(0);

  // Run Automated Closed-Loop Ellipsometry Fit (Strict 5-Stage Pipeline)
  const recordProgressParams=(params:{name:string;value:number}[])=>{
    setLiveParams(params);
    setParamHistory(previous=>{const next={...previous};for(const p of params){const history=next[p.name]??[];
      if(!history.length||Math.abs(history[history.length-1]-p.value)>1e-4)next[p.name]=[...history,p.value];}
      return next;});
  };
  const handleAutoFit = async () => {
    if(automaticBusy.current || compute.busy)return;
    if(!project.experimentData?.points.length){alert('請先匯入實驗數據');return;}
    automaticBusy.current=true;setIsFitting(true);setCurrentIter(0);setWorkflowProgress(null);setParamHistory({});
    try {
      const output=await compute.run('automatic',undefined,undefined,(progress:Progress)=>{
        setCurrentIter(progress.iteration);setLiveCost(progress.currentMse);
        if('stage' in progress){setWorkflowProgress(progress);if(progress.currentParams)recordProgressParams(progress.currentParams);}
        else if('paramValues' in progress)recordProgressParams(progress.paramValues);
      });
      setFinalOpticalConstants(output.workflow?.finalOpticalConstants??[]);
      setPipelineData(output.workflow?.pipelineData??null);setResultModalOpen(true);
    }catch(e){if(!(typeof e==='object'&&e!==null&&'name' in e&&e.name==='AbortError'))alert('擬合失敗: '+String(e));}
    finally{automaticBusy.current=false;setIsFitting(false);}
  };

  const handleValidationReport=async()=>{
    try{const output=await compute.run('validation');downloadValidationReport(output.report);}
    catch(e){if(!(typeof e==='object'&&e!==null&&'name' in e&&e.name==='AbortError'))alert('驗證報告失敗: '+String(e));}
  };

  // Export Optical Constants (n, k) vs Wavelength CSV
  const handleExportNk = () => {
    try {
      if (!project.expert && project.fittingResult && finalOpticalConstants && finalOpticalConstants.length > 0) {
        const selected=defaultOpticalExport({...project.fittingResult,finalOpticalConstants});
        exportOpticalConstantsCsv(selected.points!,'AutoEllipso_optical_constants.csv',selected.source);
        return;
      }

      // If workflow has not run yet, extract from current primary layer model
      const targetLayer = project.layers[0];
      if (!targetLayer) {
        alert('無膜層可匯出光學常數');
        return;
      }
      const modelDef = modelRegistry.get(targetLayer.modelId);
      if (!modelDef) {
        alert('找不到該膜層之色散模型');
        return;
      }
      const paramRecord: Record<string, number> = {};
      for (const [k, p] of Object.entries(targetLayer.parameters)) {
        paramRecord[k] = p.current;
      }
      const wls = project.experimentData?.points.map((p) => p.wavelength) || [];
      const uniqueWls = Array.from(new Set(wls)).sort((a, b) => a - b);
      const pointsNk = uniqueWls.map((wl) => {
        const opt = modelDef.calculate(wl, paramRecord);
        return { wavelength: wl, n: opt.n, k: opt.k };
      });
      exportOpticalConstantsCsv(pointsNk.map(q=>({...q,fitAdequacy:project.fittingResult?.fitAdequacy})), `${project.name}_${targetLayer.name}_nk`);
    } catch (err: any) {
      alert('匯出 n/k 失敗: ' + err.message);
    }
  };

  // Export Fitted Curve CSV (AutoEllipso_fitted_curve.csv)
  const handleExportFittedCurve = async () => {
    try {
      exportFittedCurveCsv(await compute.ensureForward());
    } catch (err: any) {
      alert('匯出擬合曲線失敗: ' + err.message);
    }
  };

  // Export Fitted Parameters JSON (AutoEllipso_fitted_parameters.json)
  const handleExportParametersJson = async () => {
    try {
      exportFittedParametersJson(await compute.ensureForward(), pipelineData);
    } catch (err: any) {
      alert('匯出擬合參數 JSON 失敗: ' + err.message);
    }
  };

  // Export Full Fit Report CSV (Header with final thickness/parameters + Point-by-point columns)
  const handleExportFullReport = () => {
    try {
      const optMap = new Map<number, { n: number; k: number }>();
      if (finalOpticalConstants && finalOpticalConstants.length > 0) {
        for (const pt of finalOpticalConstants) {
          optMap.set(pt.wavelength, { n: pt.n, k: pt.k });
        }
      }
      exportFullFitResultCsv(project, project.layers[0], optMap);
    } catch (err: any) {
      alert('匯出完整擬合報告失敗: ' + err.message);
    }
  };

  // Toggle active AOI for Multi-AOI fitting
  const handleToggleFitAoi = (aoi: number) => {
    const allAois = project.experimentData?.angles || [];
    const currentActive = project.fittingConfig.activeFitAois || allAois;
    let nextActive: number[];
    if (currentActive.includes(aoi)) {
      if (currentActive.length <= 1) {
        return; // Retain at least one angle
      }
      nextActive = currentActive.filter((a) => a !== aoi);
    } else {
      nextActive = [...currentActive, aoi].sort((a, b) => a - b);
    }

    setProject((prev) => ({
      ...prev,
      fittingConfig: {
        ...prev.fittingConfig,
        activeFitAois: nextActive,
      },
    }));
  };

  const handleSelectAllFitAois = (all: boolean) => {
    const allAois = project.experimentData?.angles || [];
    const nextActive = all ? allAois : allAois.slice(0, 1);
    setProject((prev) => ({
      ...prev,
      fittingConfig: {
        ...prev.fittingConfig,
        activeFitAois: nextActive,
      },
    }));
  };

  // Stop running optimizer
  const handleStopFit = () => {
    shouldStopRef.current = true;
    compute.cancel();
  };

  // Project Templates
  const handleNewProject = (template: 'sio2_multi' | 'sio2' | 'tio2' | 'blank') => {
    importSequence.current++;
    if (template === 'sio2_multi') {
      const p = createMultiAoiSiO2OnSiProject();
      setProject(p);
      setSelectedTarget(p.layers[0]?.id || 'layer_sio2_multi');
    } else if (template === 'sio2') {
      const p = createSiO2OnSiProject();
      setProject(p);
      setSelectedTarget(p.layers[0]?.id || 'layer_sio2');
    } else if (template === 'tio2') {
      const p = createTiO2OnSiProject();
      setProject(p);
      setSelectedTarget(p.layers[0]?.id || 'layer_tio2');
    } else {
      const p = createBlankProject();
      setProject(p);
      setSelectedTarget(p.layers[0]?.id || 'ambient');
    }
  };

  // Save Project JSON
  const handleSaveProject = () => {
    exportProjectJson(project);
  };

  // Open Project JSON
  const handleOpenProjectClick = () => {
    fileInputRef.current?.click();
  };

  const handleProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sequence=++importSequence.current, inputVersion=compute.revision.current;
    const reader = new FileReader();
    reader.onerror=()=>alert('無法讀取專案檔案');
    reader.onload = async (event) => {
      if(sequence!==importSequence.current||inputVersion!==compute.revision.current)return;
      try {
        const content = event.target?.result as string;
        let legacyProject = false;
        const loadedProj = importProjectJson(content, () => { legacyProject = true; });
        // Forward evaluation is performed in the dedicated browser worker.
        setProject(loadedProj);
        setSelectedTarget(loadedProj.layers[0]?.id || 'ambient');
        setPipelineData(null);setWorkflowProgress(null);setFinalOpticalConstants([]);setLiveCost(0);setPrevCost(null);setParamHistory({});setResultModalOpen(false);
        if (legacyProject) {
          await compute.ensureForward();
          if (sequence === importSequence.current) alert('此專案由舊版建立。舊版 Δ 計算慣例與量測儀器相反，模擬曲線已依新慣例重算；先前的擬合參數是在錯誤慣例下得到，請重新擬合。');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        alert('專案載入失敗: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export results CSV
  const handleExportResults = async () => {
    try {
      exportResultsCsv(await compute.ensureForward());
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle experimental CSV import
  const handleImportCsvSuccess = (dataset: ExperimentDataset) => {
    importSequence.current++;
    const calculatedPoints=dataset.points;

    setProject((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      experimentData: {
        ...dataset,
        points: calculatedPoints,
      },
      fittingConfig: {
        ...prev.fittingConfig,
        activeFitAois: dataset.angles,
      },
      visualizationSettings: {
        ...prev.visualizationSettings,
        selectedAoi: dataset.angles.length === 1 ? dataset.angles[0] : 'all',
      },
    }));
  };

  // Layer stack operations
  const handleAddLayer = () => {
    const newId = `layer_${Date.now()}`;
    const newLayer: Layer = {
      id: newId,
      name: `薄膜層 ${project.layers.length + 1}`,
      materialName: '介電質薄膜 (Dielectric)',
      thickness: 50.0,
      thicknessFit: true,
      thicknessMin: 1.0,
      thicknessMax: 300.0,
      thicknessInitial: 50.0,
      modelId: 'cauchy',
      parameters: modelRegistry.createParameterSet('cauchy'),
    };

    const newLayers = [...project.layers, newLayer];
    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      layers: newLayers,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
    setSelectedTarget(newId);
  };

  const handleDeleteLayer = (id: string) => {
    if (project.layers.length <= 1) return;
    const newLayers = project.layers.filter((l) => l.id !== id);

    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      layers: newLayers,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
    if (selectedTarget === id) {
      setSelectedTarget(newLayers[0]?.id || 'ambient');
    }
  };

  const handleDuplicateLayer = (id: string) => {
    const target = project.layers.find((l) => l.id === id);
    if (!target) return;

    const newId = `layer_${Date.now()}`;
    const duplicated: Layer = {
      ...target,
      id: newId,
      name: `${target.name} (副本)`,
      parameters: JSON.parse(JSON.stringify(target.parameters)),
    };

    const newLayers = [...project.layers, duplicated];
    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      layers: newLayers,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
    setSelectedTarget(newId);
  };

  const handleMoveLayerUp = (index: number) => {
    if (index === 0) return;
    const copy = [...project.layers];
    const temp = copy[index - 1];
    copy[index - 1] = copy[index];
    copy[index] = temp;

    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      layers: copy,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
  };

  const handleMoveLayerDown = (index: number) => {
    if (index >= project.layers.length - 1) return;
    const copy = [...project.layers];
    const temp = copy[index + 1];
    copy[index + 1] = copy[index];
    copy[index] = temp;

    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      layers: copy,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
  };

  const handleUpdateLayer = (updatedLayer: Layer) => {
    const newLayers = project.layers.map((l) => (l.id === updatedLayer.id ? updatedLayer : l));

    // Dynamic reactive recalculation
    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      layers: newLayers,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
  };

  const handleUpdateAmbient = (updatedAmbient: Ambient) => {
    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      ambient: updatedAmbient,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
  };

  const handleUpdateSubstrate = (updatedSubstrate: Substrate) => {
    const updatedPoints=project.experimentData?.points??[];

    setProject((prev) => ({
      ...prev,
      substrate: updatedSubstrate,
      experimentData: prev.experimentData
        ? { ...prev.experimentData, points: updatedPoints }
        : null,
    }));
  };

  const handleUpdateSettings = (newSettings: VisualizationSettings) => {
    setProject((prev) => ({
      ...prev,
      visualizationSettings: newSettings,
    }));
  };

  return (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Hidden File Input for Opening Projects */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleProjectFileChange}
        accept=".json"
        className="hidden"
      />

      {/* Top Application Toolbar */}
      <TopToolbar
        project={project}
        isFitting={isFitting || compute.busy}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProjectClick}
        onSaveProject={handleSaveProject}
        onOpenCsvModal={() => setCsvModalOpen(true)}
        onExportResults={handleExportFittedCurve}
        onExportNk={handleExportNk}
        onExportParametersJson={handleExportParametersJson}
        onManualCalculate={handleManualCalculate}
        onAutoFit={handleAutoFit}
        onStopFit={handleStopFit}
        onOpenModelLibrary={() => setModelLibraryOpen(true)}
        onOpenTestsModal={() => setTestsModalOpen(true)}
        onOpenStrategyModal={() => setStrategyModalOpen(true)}
      />

      {/* Automated Closed-Loop Workflow Stage Indicator */}
      {(isFitting || workflowProgress) && (
        <div className="bg-slate-900 border-b border-cyan-900/50 px-4 py-2 flex flex-col xl:flex-row items-center justify-between text-xs font-mono shrink-0 shadow-inner gap-2">
          {/* Left: Stage Name & Message */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center space-x-1.5 font-bold text-cyan-400 bg-slate-800/80 px-2 py-0.5 rounded border border-cyan-900/60">
              <span className={`w-2 h-2 rounded-full bg-cyan-400 ${isFitting ? 'animate-ping' : ''}`} />
              <span>
                階段 [{workflowProgress?.stepNumber || 1}/{workflowProgress?.totalSteps || 7}]
              </span>
            </span>

            <span className="text-slate-100 font-sans font-semibold">
              {workflowProgress?.stageName || '初始化管線...'}
            </span>

            {workflowProgress?.currentModelName && (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-cyan-300 text-[11px]">
                模型: {workflowProgress.currentModelName}
              </span>
            )}

            <span className="text-slate-400 text-[11px] truncate max-w-md">
              {workflowProgress?.message}
            </span>
          </div>

          {/* Right: Rich Telemetry Grid (Current MSE, Best MSE, Target, Thickness, Knots, Oscillators) */}
          <div className="flex flex-wrap items-center gap-3">
            {workflowProgress && (
              <>
                <div className="flex items-center space-x-2 text-[11px]">
                  <span className="text-slate-400">
                    膜厚: <b className="text-cyan-300">{workflowProgress.currentThickness.toFixed(2)} nm</b>
                  </span>

                  <span className="text-slate-400">
                    當前 MSE (Woollam): <b className="text-amber-400">{workflowProgress.currentMse.toFixed(4)}</b>
                  </span>

                  <span className="text-slate-400">
                    最佳 MSE (Woollam): <b className="text-emerald-400">{workflowProgress.bestMse.toFixed(4)}</b>
                  </span>

                  <span className="text-slate-400">
                    擬合充分性由最終統計評估
                  </span>

                  {workflowProgress.oscillatorsCount !== undefined && (
                    <span className="text-slate-400">
                      振盪子:{' '}
                      <b className="text-slate-200">
                        {workflowProgress.oscillatorsCount}/{workflowProgress.maxOscillators ?? 3}
                      </b>
                    </span>
                  )}

                  {workflowProgress.bsplineKnots !== undefined && (
                    <span className="text-slate-400">
                      Knots:{' '}
                      <b className="text-slate-200">
                        {workflowProgress.bsplineKnots}/{workflowProgress.maxBsplineKnots ?? 40}
                      </b>
                    </span>
                  )}

                  {workflowProgress.multiStartRun !== undefined && (
                    <span className="text-rose-400 bg-rose-950/40 px-1 rounded border border-rose-900/60">
                      Multi-start: {workflowProgress.multiStartRun}/{workflowProgress.totalMultiStartRuns}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="w-24 bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(5, workflowProgress.progressPercent))}%` }}
                  />
                </div>
                <span className="text-cyan-400 font-bold">{Math.round(workflowProgress.progressPercent)}%</span>

                {/* Quick Results Modal Opener button */}
                {project.fittingResult && (
                  <button
                    onClick={() => setResultModalOpen(true)}
                    className="px-2 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 border border-cyan-700 text-[11px] font-sans transition-colors"
                  >
                    檢視成果報告
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <nav className="mobile-workspace-nav" aria-label="Workspace sections"><a href="#spectra-panel">Ψ/Δ 圖表</a><a href="#stack-panel">膜層</a><a href="#parameter-panel">參數</a></nav>
      {/* Main Workspace: Left Stack Panel + Center Visualizer + Right Parameter Panel */}
      <div className="privacy-bar flex flex-wrap gap-3 items-center px-4 py-1 bg-slate-900 text-slate-200 text-sm">
        <button className="px-3 py-1 border border-cyan-600 rounded text-cyan-300" disabled={isFitting} onClick={()=>setExpertOpen(true)}>Expert Fitting Mode</button>
        <span className="text-xs">V{APP_VERSION} · {BUILD_COMMIT.slice(0,8)} · 資料只在本分頁記憶體；未儲存、不上傳。</span>
        <button className="px-2 py-1 border border-slate-600 rounded" disabled={compute.busy} onClick={handleValidationReport}>Download Validation Report</button>
        <button className="px-2 py-1 border border-slate-600 rounded" onClick={()=>{compute.cancel();importSequence.current++;setExpertOpen(false);setProject(createBlankProject());setSelectedTarget('ambient');location.hash='empty';location.reload();}}>清除本分頁資料</button>
        {compute.forwardPending && <span role="status" className="text-amber-300">完整 TMM 重算中；目前 Ψ/Δ 曲線為上一輪。</span>}
        {manualForwardError && <span role="alert" className="text-red-400">{manualForwardError}</span>}
      </div>
      {expertOpen && <React.Suspense fallback={<p className="text-cyan-300">Loading Expert Fitting…</p>}><ExpertFittingPanel project={project} onChange={setProject} onClose={()=>setExpertOpen(false)} disabled={isFitting}
        forwardPending={compute.forwardPending} forwardError={compute.error} onRecalculate={()=>compute.refresh(0)} onCancel={compute.cancel}
        onRunStage={async(stage,index,onProgress)=>{await compute.run('expert',stage,index,p=>{if('start' in p)onProgress(p);});}}/></React.Suspense>}
      <div className="workspace flex-1 flex overflow-hidden min-h-0">
        <SampleStackPanel
          sampleStructure={project.fittingConfig.sampleStructure ?? 'single_layer'}
          onToggleSampleStructure={(mode) =>
            setProject((prev) => ({
              ...prev,
              fittingConfig: { ...prev.fittingConfig, sampleStructure: mode },
            }))
          }
          ambient={project.ambient}
          layers={project.layers}
          substrate={project.substrate}
          selectedLayerId={selectedTarget}
          onSelectLayer={setSelectedTarget}
          onAddLayer={handleAddLayer}
          onDeleteLayer={handleDeleteLayer}
          onDuplicateLayer={handleDuplicateLayer}
          onMoveLayerUp={handleMoveLayerUp}
          onMoveLayerDown={handleMoveLayerDown}
        />

        <VisualizerPanel
          points={project.experimentData?.points || []}
          angles={project.experimentData?.angles || [70.0]}
          settings={project.visualizationSettings}
          onUpdateSettings={handleUpdateSettings}
          activeFitAois={project.fittingConfig.activeFitAois}
          onToggleFitAoi={handleToggleFitAoi}
          onSelectAllFitAois={handleSelectAllFitAois}
          perAoiMetrics={residualMetrics.perAoi}
        />

        <LayerParamPanel
          selectedTarget={selectedTarget}
          ambient={project.ambient}
          layers={project.layers}
          substrate={project.substrate}
          onUpdateAmbient={handleUpdateAmbient}
          onUpdateLayer={handleUpdateLayer}
          onUpdateSubstrate={handleUpdateSubstrate}
          onManualCalculate={handleManualCalculate}
        />
      </div>

      {/* Bottom Status & Optimizer Metrics Bar */}
      <FittingStatusBottomBar
        metrics={residualMetrics}
        fittingResult={project.fittingResult}
        isFitting={isFitting}
        currentIter={currentIter}
        liveCost={liveCost}
        prevCost={prevCost}
        liveParams={liveParams}
        paramHistory={paramHistory}
        activeFitAois={project.fittingConfig.activeFitAois}
      />

      {/* Modals */}
      <FittingStrategyModal
        isOpen={strategyModalOpen}
        onClose={() => setStrategyModalOpen(false)}
        config={project.fittingConfig}
        onUpdateConfig={(newConfig) =>
          setProject((prev) => ({
            ...prev,
            fittingConfig: newConfig,
          }))
        }
        onStartFit={handleAutoFit}
        isFitting={isFitting}
      />

      {project.fittingResult && (
        <FinalFitResultModal
          isOpen={resultModalOpen}
          onClose={() => setResultModalOpen(false)}
          fittingResult={project.fittingResult}
          primaryLayer={project.layers[0]}
          onExportNk={handleExportNk}
          onExportFullReport={handleExportFittedCurve}
          onExportParametersJson={handleExportParametersJson}
          targetMse={project.fittingConfig.targetMse ?? 10.0}
        />
      )}

      <CsvImportModal
        isOpen={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onImportSuccess={handleImportCsvSuccess}
      />

      <ModelLibraryModal
        isOpen={modelLibraryOpen}
        onClose={() => setModelLibraryOpen(false)}
      />

      <UnitTestsModal
        isOpen={testsModalOpen}
        onClose={() => setTestsModalOpen(false)}
      />
    </div>
  );
}
