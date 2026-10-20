import type {EllipsometryProject} from '../types/ellipsometry';
import {APP_VERSION,BUILD_COMMIT,BUILD_TIME} from '../version';
import {calculateSpectrum} from '../solver/calculator';
import {computeMultiAoiResidualMetrics} from '../fitting/residual';
import {modelRegistry} from '../modelRegistry/registry';
import {values} from '../fitting/expertWorkflow';
import {downloadFile} from './export';
export function createValidationReport(project:EllipsometryProject) {
  const input=project.experimentData?.points??[];
  if(!input.length)throw new Error('Import experimental data before exporting a validation report');
  // Independently recompute all input points from the final saved parameter set.
  const comparison=calculateSpectrum(project.ambient,project.layers,project.substrate,input);
  if(comparison.some(p=>![p.psiExp,p.deltaExp,p.psiCalc,p.deltaCalc].every(Number.isFinite)))throw new Error('Validation report requires finite measured and calculated spectra');
  const metrics=computeMultiAoiResidualMetrics(comparison,project.fittingConfig.activeFitAois,project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,project.fittingResult?.numParameters??project.fittingResult?.parameters.filter(p=>p.fitted).length??0);
  const wavelengths=Array.from(new Set(input.map(p=>p.wavelength))).sort((a,b)=>a-b);
  return {
    application:'AutoEllipso',version:APP_VERSION,buildCommit:BUILD_COMMIT,buildTime:BUILD_TIME,generatedAt:new Date().toISOString(),
    fitAdequacy:project.fittingResult?.fitAdequacy,fitAdequacyWarning:project.fittingResult?.fitAdequacyWarning,
    freeFormFitAdequacy:project.fittingResult?.freeFormFitAdequacy,freeFormFitAdequacyWarning:project.fittingResult?.freeFormFitAdequacyWarning,
    initialization:project.fittingResult?.initialization,
    freeFormOpticalConstants:project.fittingResult?.freeFormOpticalConstants,
    freeFormWarning:project.fittingResult?.freeFormWarning,
    freeFormStatistics:project.fittingResult?.freeFormStatistics,
    splineStages:project.fittingResult?.bsplineDiagnostic?.knotRefinementHistory,
    freeFormModel:project.fittingResult?.freeFormModel,
    freeFormCoefficientBounds:project.fittingResult?.freeFormCoefficientBounds,
    opticalModelComparison:project.fittingResult?.opticalModelComparison,
    statistics:project.fittingResult?.statistics,convergenceStatus:project.fittingResult?.convergenceStatus,
    calculationLocation:'This browser; no uploaded measurement data',projectName:project.name,
    measurementAoi:Array.from(new Set(input.map(p=>p.aoi))).sort((a,b)=>a-b),selectedFitAoi:metrics.selectedAois,
    wavelengthRangeNm:[wavelengths[0],wavelengths[wavelengths.length-1]],substrate:project.substrate,ambient:project.ambient,
    filmStack:project.layers.map(layer=>({id:layer.id,name:layer.name,initialThicknessNm:project.fittingResult?.parameters.find(p=>p.layerId===layer.id&&p.paramId==='thickness')?.initialValue??layer.thicknessInitial,
      finalThicknessNm:layer.thickness,selectedPhysicalModel:{id:layer.modelId,name:modelRegistry.get(layer.modelId)?.name},oscillatorParameters:layer.parameters,
      containsNoncausalCorrection:layer.modelId==='bspline'||!!layer.parameters._baseEnabled?.current||Object.keys(layer.parameters).some(key=>/^p\d+_type$/.test(key)&&layer.parameters[key].current===4&&layer.parameters[key.replace('_type','_enabled')]?.current),
      finalNk:wavelengths.map(wavelength=>{const optical=modelRegistry.get(layer.modelId)!.calculate(wavelength,values(layer));return {wavelength,...optical};})})),
    mseWoollam:metrics.mseWoollam,reducedChiSquare:metrics.reducedChiSquare,chiSquare:metrics.chiSquare,dof:metrics.dof,
    weightingMode:metrics.weightingMode,weightingWarning:metrics.weightingWarning,converged:project.fittingResult?.converged??false,
    perAoiMseWoollam:Object.fromEntries(Object.entries(metrics.perAoi).map(([a,m])=>[a,m.mseWoollam])),
    finalRawMse:metrics.rawMse,psiRmse:Math.sqrt(metrics.psiMse),deltaRmse:Math.sqrt(metrics.deltaMse),individualAoiMse:metrics.perAoi,
    finalComparison:comparison,fittingStatus:project.fittingResult?.status??'manual',fittingResult:project.fittingResult,
    finalFreshForwardVerified:true,rawMseDefinition:'sum(Psi residual^2 + shortest circular Delta residual^2) / (2 * point count), in degree^2',
  };
}
export function downloadValidationReport(report:unknown) {downloadFile('AutoEllipso_V2.1_validation_report.json',typeof report==='string'?report:JSON.stringify(report,null,2),'application/json');}
