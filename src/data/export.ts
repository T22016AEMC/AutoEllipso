import {unreliableUncertainty} from '../fitting/freeFormOptics';
/**
 * AutoEllipso Export and Persistence Utilities
 *
 * Implements the required export files:
 * 1. AutoEllipso_optical_constants.csv (Wavelength, n, k)
 * 2. AutoEllipso_fitted_curve.csv (Wavelength, AOI, Psi Experimental, Psi Calculated, Psi Residual, Delta Experimental, Delta Calculated, Delta Residual)
 * 3. AutoEllipso_fitted_parameters.json (Thickness, Cauchy parameters, B-spline knots, B-spline coefficients, Selected Physical Model, Oscillator parameters, Substrate, AOI, Raw MSE, RMSE, Psi RMSE, Delta RMSE)
 */

import { EllipsometryProject, Layer } from '../types/ellipsometry';
import {cubicBasis} from '../models/cubicSpline';
import { APP_VERSION } from '../version';
import {validateTaucLorentzParameters} from '../models/taucLorentz';
import { modelRegistry } from '../modelRegistry/registry';
import { computeMultiAoiResidualMetrics } from '../fitting/residual';
import { splineGrid, values, parameter } from '../fitting/expertWorkflow';

/**
 * Trigger download of text file in the browser
 */
export function downloadFile(filename: string, content: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Safari may consume the download after this click handler returns.
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/**
 * Export 1: AutoEllipso_optical_constants.csv
 * Columns: Wavelength, n, k
 */
export function exportOpticalConstantsCsv(
  opticalConstants: import('../fitting/freeFormOptics').OpticalConstantPoint[],
  filename: string = 'AutoEllipso_optical_constants.csv',
  source: 'physical'|'free_form' = 'physical'
): void {
  const target=source==='physical'?'AutoEllipso_optical_constants.csv':filename.endsWith('.csv')?filename:filename+'.csv';
  downloadFile(target,opticalConstantsCsv(opticalConstants,source),'text/csv');
}

export function opticalConstantsCsv(opticalConstants:import('../fitting/freeFormOptics').OpticalConstantPoint[],source:'physical'|'free_form'='physical'):string {
  if (!opticalConstants || opticalConstants.length === 0) {
    throw new Error('無可匯出的光學常數數據 (No optical constants available)。');
  }

  const rows: string[] = [];
  const hasOrigin=source==='free_form'&&opticalConstants.some(p=>p.freeFormOrigin!==undefined);
  rows.push('Wavelength,n,k,k_sigma,flag,source'+(hasOrigin?',free_form_origin':''));
  for (const pt of opticalConstants) {
    if(![pt.wavelength,pt.n,pt.k].every(Number.isFinite)||pt.kSigma!=null&&(!Number.isFinite(pt.kSigma)||pt.kSigma<0))throw new Error('Optical constants export requires finite values');
    // 17 significant digits preserve IEEE-754 doubles on CSV round-trip, including very small k.
    rows.push(`${pt.wavelength},${pt.n.toPrecision(17)},${pt.k.toExponential(16)},${pt.kSigma==null?'':pt.kSigma.toExponential(16)},${[pt.belowDetection?'below_detection':'',unreliableUncertainty(pt.fitAdequacy)?'unreliable':''].filter(Boolean).join(';')},${source}${hasOrigin?','+(pt.freeFormOrigin??''):''}`);
  }
  return rows.join('\n');
}

/**
 * Export 2: AutoEllipso_fitted_curve.csv
 * Columns: Wavelength, AOI, Psi Experimental, Psi Calculated, Psi Residual, Delta Experimental, Delta Calculated, Delta Residual
 */
export function exportFittedCurveCsv(project: EllipsometryProject): void {
  if (!project.experimentData || project.experimentData.points.length === 0) {
    throw new Error('無可匯出的擬合光譜數據 (No fitted curves to export)。');
  }

  const rows: string[] = [];
  const metrics=computeMultiAoiResidualMetrics(project.experimentData.points,project.fittingConfig.activeFitAois,project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,project.fittingResult?.numParameters??project.fittingResult?.parameters.filter(p=>p.fitted).length??0);
  rows.push('Wavelength,AOI,Psi Experimental,Psi Calculated,Psi Residual,Delta Experimental,Delta Calculated,Delta Residual,MSE Woollam,Reduced Chi Square,Chi Square,DOF,Weighting Mode,AOI MSE Woollam');

  for (const pt of project.experimentData.points) {
    const psiCalc = pt.psiCalc ?? '';
    const psiRes = pt.psiResidual ?? '';
    const deltaCalc = pt.deltaCalc ?? '';
    const deltaRes = pt.deltaResidual ?? '';

    rows.push(
      `${pt.wavelength},${pt.aoi},${pt.psiExp},${psiCalc},${psiRes},${pt.deltaExp},${deltaCalc},${deltaRes},${metrics.mseWoollam},${metrics.reducedChiSquare},${metrics.chiSquare},${metrics.dof},${metrics.weightingMode},${metrics.perAoi[pt.aoi]?.mseWoollam??''}`
    );
  }

  downloadFile('AutoEllipso_fitted_curve.csv', rows.join('\n'), 'text/csv');
}

/**
 * Export 3: AutoEllipso_fitted_parameters.json
 * Contains: Thickness, Cauchy parameters, B-spline knots, B-spline coefficients,
 * Selected Physical Model, Oscillator parameters, Substrate, AOI, Raw MSE, RMSE, Psi RMSE, Delta RMSE
 */
export function exportFittedParametersJson(
  project: EllipsometryProject,
  pipelineData?: any
): void {
  const primaryLayer = project.layers[0];
  const modelDef = primaryLayer ? modelRegistry.get(primaryLayer.modelId) : null;
  const paramRecord: Record<string, number> = {};
  if (primaryLayer) {
    for (const [k, p] of Object.entries(primaryLayer.parameters)) {
      paramRecord[k] = p.current;
    }
  }

  const liveMetrics = computeMultiAoiResidualMetrics(project.experimentData?.points??[],project.fittingConfig.activeFitAois,project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,project.fittingResult?.numParameters??project.fittingResult?.parameters.filter(p=>p.fitted).length??0);
  const rawMse = liveMetrics.rawMse;
  const rawRmse = liveMetrics.rawRmse;

  // Extract residual RMSEs
  let sumPsiSq = 0;
  let sumDeltaSq = 0;
  const pts = project.experimentData?.points || [];
  for (const pt of pts) {
    if (pt.psiResidual !== undefined) sumPsiSq += pt.psiResidual * pt.psiResidual;
    if (pt.deltaResidual !== undefined) sumDeltaSq += pt.deltaResidual * pt.deltaResidual;
  }
  const psiRmse = pts.length > 0 ? Math.sqrt(sumPsiSq / pts.length) : 0;
  const deltaRmse = pts.length > 0 ? Math.sqrt(sumDeltaSq / pts.length) : 0;

  const exportData = {
    fitAdequacy:project.fittingResult?.fitAdequacy,fitAdequacyWarning:project.fittingResult?.fitAdequacyWarning,
    freeFormFitAdequacy:project.fittingResult?.freeFormFitAdequacy,freeFormFitAdequacyWarning:project.fittingResult?.freeFormFitAdequacyWarning,
    initialization:project.fittingResult?.initialization,
    statistics:project.fittingResult?.statistics,convergenceStatus:project.fittingResult?.convergenceStatus,
    freeFormOpticalConstants:project.fittingResult?.freeFormOpticalConstants,
    finalOpticalConstants:project.fittingResult?.finalOpticalConstants,
    freeFormWarning:project.fittingResult?.freeFormWarning,
    freeFormOrigin:project.fittingResult?.freeFormOrigin,freeFormRefinement:project.fittingResult?.freeFormRefinement,
    freeFormStatistics:project.fittingResult?.freeFormStatistics,
    freeFormModel:project.fittingResult?.freeFormModel,
    freeFormCoefficientBounds:project.fittingResult?.freeFormCoefficientBounds,
    opticalModelComparison:project.fittingResult?.opticalModelComparison,
    expert: project.expert,
    layers: project.layers,
    parameterBoundsAndLocks: primaryLayer?.parameters,
    selectedAois: liveMetrics.selectedAois,
    mseWoollam:liveMetrics.mseWoollam,reducedChiSquare:liveMetrics.reducedChiSquare,chiSquare:liveMetrics.chiSquare,dof:liveMetrics.dof,
    weightingMode:liveMetrics.weightingMode,weightingWarning:liveMetrics.weightingWarning,converged:project.fittingResult?.converged??false,
    perAoiMseWoollam:Object.fromEntries(Object.entries(liveMetrics.perAoi).map(([a,m])=>[a,m.mseWoollam])),
    perAoiMse: Object.fromEntries(Object.entries(liveMetrics.perAoi).map(([a,m])=>[a,m.mse])),
    application: 'AutoEllipso',
    version: APP_VERSION,
    exportTimestamp: new Date().toISOString(),
    projectName: project.name,
    thickness: primaryLayer ? primaryLayer.thickness : 0,
    cauchyParameters: pipelineData?.cauchy0Point?.parameters || {
      A: 1.48,
      B: 0.004,
      C: 0.0,
    },
    bsplineKnots: primaryLayer?.parameters._knotCount ? splineGrid(primaryLayer) : pipelineData?.bspline?.nodeWavelengths || [],
    bsplineCoefficients: primaryLayer?.modelId==='bspline'?values(primaryLayer):pipelineData?.bspline?.nodeCoefficients || {},
    bsplineDiagnostic: {
      skipped:project.fittingResult?.bsplineDiagnostic?.skipped,
      warning:project.fittingResult?.freeFormWarning,
      sourceModel:project.fittingResult?.bsplineDiagnostic?.sourceModel,
      weightedRegularizationPenalty:pipelineData?.bspline?.weightedRegularizationPenalty??project.fittingResult?.bsplineDiagnostic?.weightedRegularizationPenalty,
      weightedTotalObjective:pipelineData?.bspline?.weightedTotalObjective??project.fittingResult?.bsplineDiagnostic?.weightedTotalObjective,
      rawMse: pipelineData?.bspline?.rawMse ?? project.fittingResult?.bsplineDiagnostic?.rawMse ?? 0,
      regularizationPenalty:
        pipelineData?.bspline?.regularizationPenalty ??
        project.fittingResult?.bsplineDiagnostic?.regularizationPenalty ??
        0,
      smoothN: pipelineData?.bspline?.smoothN ?? project.fittingResult?.bsplineDiagnostic?.smoothN ?? 0,
      smoothK: pipelineData?.bspline?.smoothK ?? project.fittingResult?.bsplineDiagnostic?.smoothK ?? 0,
      totalObjective:
        pipelineData?.bspline?.totalObjective ??
        project.fittingResult?.bsplineDiagnostic?.totalObjective ??
        0,
      knotRefinementHistory:
        pipelineData?.bspline?.knotRefinementHistory ??
        project.fittingResult?.bsplineDiagnostic?.knotRefinementHistory ??
        [],
    },
    selectedPhysicalModel: modelDef?.name || primaryLayer?.modelId || 'Gaussian',
    oscillatorParameters: paramRecord,
    multiStartSummary: pipelineData?.multiStartSummary ?? project.fittingResult?.multiStartSummary ?? null,
    substrate: {
      name: project.substrate.name,
      modelId: project.substrate.modelId,
      parameters: project.substrate.parameters,
    },
    aoi: project.experimentData?.angles || [70.0],
    rawMse,
    rmse: rawRmse,
    psiRmse,
    deltaRmse,
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  downloadFile('AutoEllipso_fitted_parameters.json', jsonStr, 'application/json');
}

/**
 * Export complete comprehensive fit result
 */
export function exportFullFitResultCsv(
  project: EllipsometryProject,
  _primaryLayer?: Layer,
  _optConstantsMap?: Map<number, { n: number; k: number }>
): void {
  exportFittedCurveCsv(project);
}

/**
 * Export complete Project as JSON
 */
export function exportProjectJson(project: EllipsometryProject): void {
  const jsonStr = JSON.stringify({
    ...project,
    deltaConventionVersion: 2,
    experimentData: project.experimentData ? {
      ...project.experimentData,
      deltaConvention: project.experimentData.deltaConvention ?? 'standard',
    } : null,
  }, null, 2);
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  downloadFile(`${safeName}_AutoEllipso_project.json`, jsonStr, 'application/json');
}

/**
 * Export numerical results (Full report)
 */
export function exportResultsCsv(project: EllipsometryProject): void {
  exportFittedCurveCsv(project);
}

/**
 * Parse and validate uploaded project JSON
 */
export function importProjectJson(jsonContent: string, onLegacyProject?: () => void): EllipsometryProject {
  const parsed = JSON.parse(jsonContent);
  if (!parsed.layers || !Array.isArray(parsed.layers)) {
    throw new Error('Invalid AutoEllipso project: missing layers definition.');
  }
  if (!parsed.substrate || !parsed.ambient) {
    throw new Error('Invalid AutoEllipso project: missing substrate or ambient configuration.');
  }
  if (parsed.experimentData) parsed.experimentData.deltaConvention ??= 'standard';
  const validateDomains=(saved:EllipsometryProject)=>{
    for(const layer of [...saved.layers,...(saved.fittingResult?.freeFormModel?.layers??[]),saved.substrate]) {
      validateTaucLorentzParameters(layer.modelId,Object.fromEntries(Object.entries(layer.parameters??{}).map(([k,v])=>[k,v.current])));
      if('thickness' in layer&&(layer.modelId==='bspline'||layer.modelId==='expert_mixed')) {
        const count=layer.parameters._knotCount?.current??8;
        if(!Number.isInteger(count)||count<4||count>40)throw new Error('Spline control count must be an integer from 4 to 40');
        const grid=splineGrid(layer);cubicBasis(grid[0],grid);
        if(layer.parameters._knotCount)layer.parameters._knotCount.max=40;
      }
    }
  };
  validateDomains(parsed);
  for(const candidate of parsed.expert?.candidates??[])validateDomains(candidate.snapshot);
  if(parsed.expert?.manualSource)validateDomains(parsed.expert.manualSource);
  if (parsed.deltaConventionVersion === undefined) {
    const invalidate = (saved: Omit<EllipsometryProject, 'expert'>) => {
      saved.deltaConventionVersion = 2;
      saved.fittingResult = null;
      if (saved.experimentData) {
        saved.experimentData.deltaConvention ??= 'standard';
        for (const point of saved.experimentData.points) {
          delete point.psiCalc;
          delete point.deltaCalc;
          delete point.psiResidual;
          delete point.deltaResidual;
        }
      }
    };
    invalidate(parsed);
    for (const candidate of parsed.expert?.candidates ?? []) invalidate(candidate.snapshot);
    if (parsed.expert?.manualSource) invalidate(parsed.expert.manualSource);
    if (parsed.expert) parsed.expert.records = [];
    onLegacyProject?.();
  }
  // Old JSON files did not serialize their global B-spline grid. Persist the
  // compatible active grid on import so each V2 layer now evaluates independently.
  for(const layer of parsed.layers)if(layer.modelId==='bspline'&&layer.parameters?._knot0===undefined) {
    const grid=splineGrid(layer);layer.parameters._knotCount=parameter('_knotCount',grid.length,4,40,false);
    grid.forEach((w,i)=>layer.parameters[`_knot${i}`]=parameter(`_knot${i}`,w,150,2500,false));
  }
  return parsed as EllipsometryProject;
}
