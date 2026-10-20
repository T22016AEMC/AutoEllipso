import {assessFitAdequacy} from './freeFormOptics';
import { computeFitStatistics, isSplineCoefficient } from './statistics';
/**
 * Unified Fitting Engine
 * Connects the Optical Model Stack, TMM Solver, Residual Metrics, and Bounded LM Optimizer.
 */
import {
  Ambient,
  Layer,
  Substrate,
  EllipsometryDataPoint,
  FittingConfig,
  FittingResult,
  FittedParameterResult,
} from '../types/ellipsometry';
import { OptimizationVariable, optimizeBoundedLM } from './optimizer';
import { calculateSpectrum } from '../solver/calculator';
import { computeResidualMetrics, computeMultiAoiResidualMetrics, circularDifferenceDeg, residualWeights } from './residual';
import { calculatePoint } from '../solver/calculator';

export interface FitTargetReference {
  type: 'layer_thickness' | 'layer_param' | 'substrate_param';
  layerIndex?: number;
  layerId?: string;
  layerName?: string;
  paramId?: string;
  paramName: string;
  initialValue: number;
  min: number;
  max: number;
  unit: string;
}

export interface RunFitOptions {
  ambient: Ambient;
  layers: Layer[];
  substrate: Substrate;
  points: EllipsometryDataPoint[];
  config: FittingConfig;
  selectedAois?: number[];
  onProgress?: (info: {
    iteration: number;
    currentMse: number;
    previousMse: number | null;
    currentRmse: number;
    paramValues: { name: string; value: number }[];
  }) => void;
  shouldStop?: () => boolean;
}

export interface FitEngineOutput {
  updatedLayers: Layer[];
  updatedSubstrate: Substrate;
  updatedPoints: EllipsometryDataPoint[];
  fittingResult: FittingResult;
}

/**
 * Run Auto Fit on current project state
 */
export async function runAutoFit(options: RunFitOptions): Promise<FitEngineOutput> {
  const { ambient, layers, substrate, points, config, onProgress, shouldStop } = options;
  const startTime = performance.now();

  // 1. Gather all active parameters with fit === true
  const targets: FitTargetReference[] = [];
  const variables: OptimizationVariable[] = [];

  // Deep clone layers and substrate so we do not mutate original until completion
  const clonedLayers: Layer[] = JSON.parse(JSON.stringify(layers));
  const clonedSubstrate: Substrate = JSON.parse(JSON.stringify(substrate));

  // Check layer thickness
  clonedLayers.forEach((layer, layerIdx) => {
    if (layer.thicknessFit) {
      targets.push({
        type: 'layer_thickness',
        layerIndex: layerIdx,
        layerId: layer.id,
        layerName: layer.name,
        paramName: `${layer.name} Thickness`,
        initialValue: layer.thickness,
        min: layer.thicknessMin,
        max: layer.thicknessMax,
        unit: 'nm',
      });
      variables.push({
        id: `${layer.id}_thickness`,
        name: `${layer.name} Thickness`,
        value: layer.thickness,
        min: layer.thicknessMin,
        max: layer.thicknessMax,
      });
    }

    // Check layer model parameters
    Object.values(layer.parameters).forEach((param) => {
      if (param.fit) {
        targets.push({
          type: 'layer_param',
          layerIndex: layerIdx,
          layerId: layer.id,
          layerName: layer.name,
          paramId: param.id,
          paramName: `${layer.name} ${param.name}`,
          initialValue: param.current,
          min: param.min,
          max: param.max,
          unit: param.unit,
        });
        variables.push({
          id: `${layer.id}_${param.id}`,
          name: `${layer.name} ${param.name}`,
          value: param.current,
          min: param.min,
          max: param.max,
        });
      }
    });
  });

  // Check substrate model parameters
  Object.values(clonedSubstrate.parameters).forEach((param) => {
    if (param.fit) {
      targets.push({
        type: 'substrate_param',
        paramId: param.id,
        paramName: `Substrate ${param.name}`,
        initialValue: param.current,
        min: param.min,
        max: param.max,
        unit: param.unit,
      });
      variables.push({
        id: `substrate_${param.id}`,
        name: `Substrate ${param.name}`,
        value: param.current,
        min: param.min,
        max: param.max,
      });
    }
  });

  // Determine active AOIs for fitting (default to all available in dataset)
  const allAois = Array.from(new Set(points.map((p) => p.aoi))).sort((a, b) => a - b);
  const activeAois =
    options.selectedAois && options.selectedAois.length > 0
      ? options.selectedAois
      : config.activeFitAois && config.activeFitAois.length > 0
      ? config.activeFitAois
      : allAois;

  const aoiFilteredPoints = points.filter((p) => activeAois.includes(p.aoi));

  // Filter points strictly by fitting wavelength range (default 190nm ~ 900nm)
  const fitWlMin = config.fitWavelengthMin ?? 190;
  const fitWlMax = config.fitWavelengthMax ?? 900;
  const inRangePoints = aoiFilteredPoints.filter(
    (p) => p.wavelength >= fitWlMin && p.wavelength <= fitWlMax
  );
  const fittingPoints = inRangePoints.length > 0 ? inRangePoints : aoiFilteredPoints;

  // Initial calculation to obtain baseline metrics
  const initialPoints = calculateSpectrum(ambient, clonedLayers, clonedSubstrate, points);
  const initialFittingPoints = calculateSpectrum(ambient, clonedLayers, clonedSubstrate, fittingPoints);
  const initialMetrics = computeMultiAoiResidualMetrics(initialFittingPoints, activeAois, config.fitWeighting, config.psiWeight, config.deltaWeight, variables.length);

  if (variables.length === 0) {
    return {
      updatedLayers: clonedLayers,
      updatedSubstrate: clonedSubstrate,
      updatedPoints: initialPoints,
      fittingResult: {
        mseWoollam:initialMetrics.mseWoollam,reducedChiSquare:initialMetrics.reducedChiSquare,chiSquare:initialMetrics.chiSquare,dof:initialMetrics.dof,
        weightingMode:initialMetrics.weightingMode,weightingWarning:initialMetrics.weightingWarning,
        converged:true,status: 'converged',
        numParameters:0,rawMse:initialMetrics.rawMse,rawRmse:initialMetrics.rawRmse,
        perAoiMse:Object.fromEntries(Object.entries(initialMetrics.perAoi).map(([a,m])=>[a,m.rawMse])),
        perAoiMseWoollam:Object.fromEntries(Object.entries(initialMetrics.perAoi).map(([a,m])=>[a,m.mseWoollam])),
        iterations: 0,
        initialMse: initialMetrics.mse,
        finalMse: initialMetrics.mse,
        initialRmse: initialMetrics.rmse,
        finalRmse: initialMetrics.rmse,
        executionTimeMs: performance.now() - startTime,
        parameters: [],
        message: '未勾選任何待擬合參數 [FIT ON]。請在右側參數面板中開啟膜厚或模型參數之擬合開關。',
        fittingMode: activeAois.length > 1 ? 'multi_aoi' : 'single_aoi',
        selectedAois: activeAois,
      },
    };
  }

  // Helper to apply parameter vector to working layer stack
  const applyParameters = (pVector: number[]) => {
    pVector.forEach((val, idx) => {
      const target = targets[idx];
      if (target.type === 'layer_thickness' && target.layerIndex !== undefined) {
        clonedLayers[target.layerIndex].thickness = val;
      } else if (
        target.type === 'layer_param' &&
        target.layerIndex !== undefined &&
        target.paramId
      ) {
        clonedLayers[target.layerIndex].parameters[target.paramId].current = val;
      } else if (target.type === 'substrate_param' && target.paramId) {
        clonedSubstrate.parameters[target.paramId].current = val;
      }
    });
  };

  const weights=residualWeights(fittingPoints,config).weights;
  // Interleaved unweighted degrees; LM differences Delta before applying weights.
  const residualFn = (paramVector:number[]):number[] => {
    applyParameters(paramVector);
    return fittingPoints.flatMap(pt=>{
      const calc=calculatePoint(ambient,clonedLayers,clonedSubstrate,pt.wavelength,pt.aoi);
      return [calc.psiDeg-pt.psiExp,circularDifferenceDeg(calc.deltaDeg,pt.deltaExp)];
    });
  };

  // 2. Global Coarse Synthesis / Thickness Pre-scan
  // For thin film interference, sinusoidal phase wrapping can cause local saddle ridges.
  // If thickness is being fitted and initial MSE is elevated (> 5.0), evaluate a coarse grid
  // to avoid falling into false unphysical local minima.
  const hasThicknessTarget = targets.some((t) => t.type === 'layer_thickness');
  if (hasThicknessTarget && initialMetrics.mse > 5.0) {
    targets.forEach((target, varIdx) => {
      if (target.type === 'layer_thickness' && target.layerIndex !== undefined) {
        const minT = target.min;
        const maxT = target.max;
        const steps = 18;
        let bestT = target.initialValue;
        let lowestCost = initialMetrics.weightedMse;

        for (let s = 0; s <= steps; s++) {
          const testT = minT + (s / steps) * (maxT - minT);
          const trialParams = variables.map((v, i) => (i === varIdx ? testT : v.value));
          const testResiduals = residualFn(trialParams);
          const testCost =
            testResiduals.reduce((acc, r, i) => acc + (weights[i]*r)**2, 0) / Math.max(1, testResiduals.length);
          if (testCost < lowestCost) {
            lowestCost = testCost;
            bestT = testT;
          }
        }
        clonedLayers[target.layerIndex].thickness = bestT;
        variables[varIdx].value = bestT;
      }
    });
  }

  // Run bounded Levenberg-Marquardt optimizer
  let previousWoollam:number|null=null;
  const optResult = await optimizeBoundedLM(variables, residualFn, {
    maxIterations: config.maxIterations,
    tolerance: config.tolerance,
    initialLambda: config.dampingFactor,
    residualWeights:weights,
    isAngularResidual: (index: number) => index % 2 === 1,
    shouldStop,
    onIteration: (iter, currentCost, prevCost, currentParamVals, _raw, _reg, weightedCost) => {
      const mseWoollam=Math.sqrt(weightedCost!*2*fittingPoints.length/Math.max(1,2*fittingPoints.length-variables.length));
      if (onProgress) {
        onProgress({
          iteration: iter,
          currentMse: mseWoollam,
          previousMse: previousWoollam,
          currentRmse: Math.sqrt(currentCost),
          paramValues: variables.map((v, i) => ({
            name: v.name,
            value: currentParamVals[i],
          })),
        });
      }
      previousWoollam=mseWoollam;
    },
  });

  // Apply final parameters
  applyParameters(optResult.finalParams);

  // Recalculate final spectrum
  const finalPoints = calculateSpectrum(ambient, clonedLayers, clonedSubstrate, points);
  const finalFittingPoints = calculateSpectrum(ambient, clonedLayers, clonedSubstrate, fittingPoints);
  const finalMetrics = computeResidualMetrics(finalFittingPoints, config.fitWeighting, config.psiWeight, config.deltaWeight, variables.length);

  const statistics=optResult.stopped?undefined:computeFitStatistics(variables.map((v,i)=>({...v,
    id:`${targets[i].layerId??'substrate'}.${targets[i].paramId??'thickness'}`,
    locked:v.max===v.min,splineCoefficient:isSplineCoefficient(targets[i].paramId??'thickness')})),optResult.finalParams,residualFn,{weights});

  // Build structured parameter comparison report
  const fittedParamResults: FittedParameterResult[] = targets.map((t, idx) => {
    const finalVal = optResult.finalParams[idx];
    return {
      layerId: t.layerId || 'substrate',
      layerName: t.layerName || 'Substrate',
      paramId: t.paramId || 'thickness',
      paramName: t.paramName,
      initialValue: t.initialValue,
      finalValue: finalVal,
      min: t.min,
      max: t.max,
      unit: t.unit,
      fitted: true,
    };
  });

  const improved = finalMetrics.weightedMse < initialMetrics.weightedMse;
  const status: FittingResult['status'] = optResult.stopped
    ? 'stopped'
    : optResult.converged
    ? 'converged'
    : !improved
    ? 'failed'
    : 'max_iter';

  const message = optResult.stopped
    ? '使用者已中止擬合程序。'
    : optResult.converged
    ? `擬合收斂成功！共執行 ${optResult.iterations} 次迭代。`
    : !improved
    ? 'Fitting failed to improve the objective function. (擬合無法進一步降低目標誤差)'
    : `已達最大迭代上限 (${config.maxIterations} 次)。`;

  const perAoiMse: Record<number, number> = {};
  activeAois.forEach((aoi) => {
    const aoiPts = finalFittingPoints.filter((p) => p.aoi === aoi);
    if (aoiPts.length > 0) {
      const m = computeResidualMetrics(aoiPts, initialMetrics.weightingMode==='sigma'?'standard_deviation':initialMetrics.weightingMode, config.psiWeight, config.deltaWeight, variables.length);
      perAoiMse[aoi] = m.mse;
    }
  });

  return {
    updatedLayers: clonedLayers,
    updatedSubstrate: clonedSubstrate,
    updatedPoints: finalPoints,
    fittingResult: {
      statistics,fitAdequacy:assessFitAdequacy(statistics,finalMetrics.weightingMode).fitAdequacy,fitAdequacyWarning:assessFitAdequacy(statistics,finalMetrics.weightingMode).warning,
      mseWoollam:finalMetrics.mseWoollam,reducedChiSquare:finalMetrics.reducedChiSquare,chiSquare:finalMetrics.chiSquare,dof:finalMetrics.dof,
        weightingMode:finalMetrics.weightingMode,weightingWarning:finalMetrics.weightingWarning,
      rawMse:finalMetrics.rawMse,rawRmse:finalMetrics.rawRmse,psiRmse:Math.sqrt(finalMetrics.psiMse),deltaRmse:Math.sqrt(finalMetrics.deltaMse),
      convergenceStatus:optResult.status,improved:optResult.improved,converged:optResult.converged,numParameters:variables.length,
      perAoiMseWoollam:Object.fromEntries(Object.entries(computeMultiAoiResidualMetrics(finalFittingPoints,activeAois,config.fitWeighting,config.psiWeight,config.deltaWeight,variables.length).perAoi).map(([a,m])=>[a,m.mseWoollam])),
      status,
      iterations: optResult.iterations,
      initialMse: initialMetrics.mse,
      finalMse: finalMetrics.mse,
      initialRmse: initialMetrics.rmse,
      finalRmse: finalMetrics.rmse,
      executionTimeMs: performance.now() - startTime,
      parameters: fittedParamResults,
      message,
      fittingMode: activeAois.length > 1 ? 'multi_aoi' : 'single_aoi',
      selectedAois: activeAois,
      perAoiMse,
    },
  };
}
