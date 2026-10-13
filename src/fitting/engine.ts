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
import { computeResidualMetrics, circularDifferenceDeg } from './residual';
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
  const initialMetrics = computeResidualMetrics(initialFittingPoints, config.fitWeighting);

  if (variables.length === 0) {
    return {
      updatedLayers: clonedLayers,
      updatedSubstrate: clonedSubstrate,
      updatedPoints: initialPoints,
      fittingResult: {
        status: 'converged',
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

  // Residual function for LM: returns [rPsi[0]..rPsi[N-1], rDelta[0]..rDelta[N-1]]
  const residualFn = (paramVector: number[]): number[] => {
    applyParameters(paramVector);

    const rPsi: number[] = [];
    const rDelta: number[] = [];

    let wPsi = 1.0;
    let wDelta = 1.0;
    if (config.fitWeighting === 'psi_dominant') {
      wPsi = 2.0;
      wDelta = 0.5;
    }

    const sqrtWPsi = Math.sqrt(wPsi);
    const sqrtWDelta = Math.sqrt(wDelta);

    for (const pt of fittingPoints) {
      const calc = calculatePoint(ambient, clonedLayers, clonedSubstrate, pt.wavelength, pt.aoi);
      const psiDiff = calc.psiDeg - pt.psiExp;
      const deltaDiff = circularDifferenceDeg(calc.deltaDeg, pt.deltaExp);

      const ptW = pt.weight ? Math.sqrt(pt.weight) : 1.0;

      rPsi.push(psiDiff * sqrtWPsi * ptW);
      rDelta.push(deltaDiff * sqrtWDelta * ptW);
    }

    return [...rPsi, ...rDelta];
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
        let lowestCost = initialMetrics.mse;

        for (let s = 0; s <= steps; s++) {
          const testT = minT + (s / steps) * (maxT - minT);
          const trialParams = variables.map((v, i) => (i === varIdx ? testT : v.value));
          const testResiduals = residualFn(trialParams);
          const testCost =
            testResiduals.reduce((acc, r) => acc + r * r, 0) / Math.max(1, testResiduals.length);
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
  const optResult = await optimizeBoundedLM(variables, residualFn, {
    maxIterations: config.maxIterations,
    tolerance: config.tolerance,
    initialLambda: config.dampingFactor,
    isAngularResidual: (index: number) => index >= fittingPoints.length,
    shouldStop,
    onIteration: (iter, currentCost, prevCost, currentParamVals) => {
      if (onProgress) {
        onProgress({
          iteration: iter,
          currentMse: currentCost,
          previousMse: prevCost,
          currentRmse: Math.sqrt(currentCost),
          paramValues: variables.map((v, i) => ({
            name: v.name,
            value: Number(currentParamVals[i].toFixed(4)),
          })),
        });
      }
    },
  });

  // Apply final parameters
  applyParameters(optResult.finalParams);

  // Recalculate final spectrum
  const finalPoints = calculateSpectrum(ambient, clonedLayers, clonedSubstrate, points);
  const finalFittingPoints = calculateSpectrum(ambient, clonedLayers, clonedSubstrate, fittingPoints);
  const finalMetrics = computeResidualMetrics(finalFittingPoints, config.fitWeighting);

  // Build structured parameter comparison report
  const fittedParamResults: FittedParameterResult[] = targets.map((t, idx) => {
    const finalVal = optResult.finalParams[idx];
    return {
      layerId: t.layerId || 'substrate',
      layerName: t.layerName || 'Substrate',
      paramId: t.paramId || 'thickness',
      paramName: t.paramName,
      initialValue: Number(t.initialValue.toFixed(4)),
      finalValue: Number(finalVal.toFixed(4)),
      min: t.min,
      max: t.max,
      unit: t.unit,
      fitted: true,
    };
  });

  const improved = finalMetrics.mse < initialMetrics.mse - 1e-6;
  const status: FittingResult['status'] = optResult.stopped
    ? 'stopped'
    : !improved
    ? 'failed'
    : optResult.converged
    ? 'converged'
    : 'max_iter';

  const message = optResult.stopped
    ? '使用者已中止擬合程序。'
    : !improved
    ? 'Fitting failed to improve the objective function. (擬合無法進一步降低目標誤差)'
    : optResult.converged
    ? `擬合收斂成功！共執行 ${optResult.iterations} 次迭代。`
    : `已達最大迭代上限 (${config.maxIterations} 次)。`;

  const perAoiMse: Record<number, number> = {};
  activeAois.forEach((aoi) => {
    const aoiPts = finalFittingPoints.filter((p) => p.aoi === aoi);
    if (aoiPts.length > 0) {
      const m = computeResidualMetrics(aoiPts, config.fitWeighting);
      perAoiMse[aoi] = m.mse;
    }
  });

  return {
    updatedLayers: clonedLayers,
    updatedSubstrate: clonedSubstrate,
    updatedPoints: finalPoints,
    fittingResult: {
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
