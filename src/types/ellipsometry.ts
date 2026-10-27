import type {PeakInitialization} from '../models/peakInitialization';
import type { FitStatistics } from '../fitting/statistics';
import type { ConvergenceStatus } from '../fitting/numerics';
/**
 * Core type definitions for Thin-Film Spectroscopic Ellipsometry
 */

export interface ComplexNumber {
  re: number;
  im: number;
}

export interface OpticalConstants {
  n: number;
  k: number;
  eps1?: number;
  eps2?: number;
}

export type ModelType = 'dispersion' | 'oscillator' | 'tabulated' | 'effective_medium' | 'custom';

export interface ModelValidRange {
  minWavelengthNm: number;
  maxWavelengthNm: number;
  minEnergyEv?: number;
  maxEnergyEv?: number;
}

export interface ParameterDef {
  id: string;
  name: string;
  symbol: string;
  unit: string;
  description: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  fitSupported: boolean;
  isFittingCandidate?: boolean;
}

export interface ParameterValue {
  id: string;
  name: string;
  symbol?: string;
  unit: string;
  current: number;
  initial: number;
  min: number;
  max: number;
  fit: boolean;
  fitSupported?: boolean;
}

export interface ModelDefinition {
  id: string;
  name: string;
  type: ModelType;
  category?: ModelType; // Backward-compatible alias
  description: string;
  reference: string;
  equation: string;
  equationDoc?: string; // Backward-compatible alias
  parameters: ParameterDef[];
  validRange: ModelValidRange;
  version: string;
  fitSupported: boolean;
  isVerified: boolean;
  // Discrete evaluation helpers
  calculateN: (wavelengthNm: number, params: Record<string, number>) => number;
  calculateK: (wavelengthNm: number, params: Record<string, number>) => number;
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>) => { eps1: number; eps2: number };
  // Full optical constants evaluation
  calculate: (wavelengthNm: number, params: Record<string, number>) => OpticalConstants;
}

export interface MaterialDefinition {
  id: string;
  name: string;
  category: 'dielectric' | 'semiconductor' | 'conductor' | 'glass' | 'polymer';
  description: string;
  defaultModelId: string;
  defaultParameters: Record<string, number>;
  reference: string;
  validRange: {
    minWavelengthNm: number;
    maxWavelengthNm: number;
  };
}

export interface Layer {
  id: string;
  name: string;
  materialName: string;
  thickness: number; // in nm
  thicknessFit: boolean;
  thicknessMin: number;
  thicknessMax: number;
  thicknessInitial: number;
  modelId: string;
  parameters: Record<string, ParameterValue>;
  roughness?: number; // optional surface roughness in nm
}

export interface Substrate {
  name: string;
  materialType: 'tabulated' | 'cauchy' | 'constant';
  modelId: string;
  parameters: Record<string, ParameterValue>;
}

export interface Ambient {
  name: string;
  n: number;
  k: number;
}

export interface EllipsometryDataPoint {
  id: string;
  wavelength: number; // in nm
  aoi: number; // Angle of Incidence in degrees (e.g. 70°)
  psiExp: number; // in degrees [0, 90]
  deltaExp: number; // in degrees [0, 360]
  psiSigma?: number; // degrees, >0
  deltaSigma?: number; // degrees, >0
  psiCalc?: number;
  deltaCalc?: number;
  psiResidual?: number;
  deltaResidual?: number;
  weight?: number;
}

export interface ExperimentDataset {
  deltaConvention: 'standard' | 'reversed';
  filename: string;
  importedAt: string;
  points: EllipsometryDataPoint[];
  angles: number[]; // Distinct angles of incidence
  wavelengthMin: number;
  wavelengthMax: number;
}

export interface FittingConfig {
  maxIterations: number;
  tolerance: number; // stopping criteria on gradient or residual reduction
  dampingFactor: number; // initial Levenberg-Marquardt lambda
  fitWeighting: 'uniform' | 'standard_deviation' | 'psi_dominant';
  fitWavelengthMin?: number; // Fitting wavelength lower bound in nm (default: 190)
  fitWavelengthMax?: number; // Fitting wavelength upper bound in nm (default: 900)
  activeFitAois?: number[]; // Selected AOIs participating in fitting (defaults to all available)
  // Aggressive / Forced Fit Controls
  fittingStrategy?: 'standard' | 'aggressive';
  /** @deprecated Legacy compatibility field; not a fit-adequacy criterion. */
  targetMse?: number; // Default 10.0
  maxOscillators?: number; // Default 3 (1 to 3)
  sampleStructure?: 'single_layer' | 'multi_layer'; // Default 'single_layer'
  knotMode?: 'auto' | 'manual'; // Default 'auto'
  knotCount?: number; // 8, 12, 16, 20, 24, 32, 40
  oscillatorComplexity?: 'auto' | 1 | 2 | 3; // Default 'auto'
  minThickness?: number; // Default 0.1 nm
  maxThickness?: number; // Default 5000 nm
  maxBsplineKnots?: number; // Default 40 (8 to 40)
  enableMultiStart?: boolean; // Default true
  enableAdaptiveModel?: boolean; // Default true
  enablePhysicalConstraints?: boolean; // Default true
  psiWeight?: number; // Default 1.0
  deltaWeight?: number; // Default 1.0
  finalPhysicalModelSelection?: 'current_layer' | 'auto' | string; // User-selected final physical model or 'auto'
}

export interface FittedParameterResult {
  layerId: string;
  layerName: string;
  paramId: string;
  paramName: string;
  initialValue: number;
  finalValue: number;
  min: number;
  max: number;
  unit: string;
  fitted: boolean;
  confidenceInterval?: number;
}

export interface FittingResult {
  underdetermined?: boolean;
  freeFormUnderdetermined?: boolean;
  fitAdequacy?: import('../fitting/freeFormOptics').FitAdequacy;
  fitAdequacyWarning?:string;
  freeFormFitAdequacy?: import('../fitting/freeFormOptics').FitAdequacy;
  freeFormFitAdequacyWarning?:string;
  freeFormWarning?:string;
  freeFormOrigin?:import('../fitting/freeFormRefine').FreeFormOrigin;
  freeFormRefinement?:import('../fitting/freeFormRefine').FreeFormRefinement;
  freeFormOpticalConstants?: import('../fitting/freeFormOptics').OpticalConstantPoint[];
  finalOpticalConstants?: import('../fitting/freeFormOptics').OpticalConstantPoint[];
  freeFormStatistics?: FitStatistics;
  freeFormModel?: {primaryLayerIndex:number;layers:Layer[];variables:import('../fitting/optimizer').OptimizationVariable[];lambdaN:number;lambdaK:number};
  freeFormCoefficientBounds?: {id:string;value:number;min:number;max:number;boundaryHit:boolean}[];
  opticalModelComparison?: import('../fitting/freeFormOptics').OpticalModelComparison;
  initialization?: PeakInitialization;
  statistics?: FitStatistics;
  convergenceStatus?: ConvergenceStatus;
  improved?: boolean;
  mseWoollam?: number;
  reducedChiSquare?: number;
  chiSquare?: number;
  dof?: number;
  weightingMode?: 'sigma'|'uniform'|'psi_dominant';
  weightingWarning?: string;
  converged?: boolean;
  perAoiMseWoollam?: Record<number,number>;
  status:
    | 'idle'
    | 'running'
    | 'converged'
    | 'stopped'
    | 'failed'
    | 'max_iter'
    /** @deprecated Compatibility only; use fitAdequacy for assessment. */
    | 'target_achieved'
    /** @deprecated Compatibility only; use fitAdequacy for assessment. */
    | 'target_not_achieved'
    | 'not_converged';
  iterations: number;
  initialMse: number;
  finalMse: number; // Raw MSE
  initialRmse: number;
  finalRmse: number;
  rawMse?: number;
  rawRmse?: number;
  psiRmse?: number;
  deltaRmse?: number;
  weightedMse?: number;
  /** @deprecated Legacy compatibility field; not a fit-adequacy criterion. */
  targetMse?: number;
  /** @deprecated Legacy compatibility field; not a fit-adequacy criterion. */
  targetAchieved?: boolean;
  aic?: number;
  bic?: number;
  numParameters?: number;
  isOverfitting?: boolean;
  largestResidualRegion?: string;
  possibleCauses?: string[];
  executionTimeMs: number;
  parameters: FittedParameterResult[];
  message: string;
  fittingMode?: 'single_aoi' | 'multi_aoi';
  selectedAois?: number[];
  perAoiMse?: Record<number, number>;
  bsplineDiagnostic?: {
    skipped?: boolean;
    warning?: string;
    sourceModel?: string;
    rawMse: number;
    rawRmse: number;
    psiRmse: number;
    deltaRmse: number;
    regularizationPenalty?: number;
    weightedRegularizationPenalty?:number;
    weightedTotalObjective?:number;
    smoothN?: number;
    smoothK?: number;
    totalObjective?: number;
    activeKnots?: number;
    knotRefinementHistory?: import('../fitting/splineRefinement').SplineStageResult[];
  };
  multiStartSummary?: {
    totalStarts: number;
    validStarts: number;
    bestStartIndex: number;
    bestRawMse: number;
    bestMseWoollam?: number;
  };
  physicalModelMismatch?: boolean;
  freshCalculationVerified?: boolean;
}

export interface VisualizationSettings {
  showExperimental: boolean;
  showCalculated: boolean;
  showResiduals: boolean;
  selectedAoi: number | 'all';
  activeTab: 'psi' | 'delta' | 'both' | 'residuals';
  zoomState?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
}

export interface EllipsometryProject {
  deltaConventionVersion?: number; // 2: standard measured/instrument Delta convention
  expert?: import('../fitting/expertWorkflow').ExpertSession;
  id: string;
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  sampleStructure?: 'single_layer' | 'multi_layer';
  ambient: Ambient;
  layers: Layer[];
  substrate: Substrate;
  experimentData: ExperimentDataset | null;
  fittingConfig: FittingConfig;
  fittingResult: FittingResult | null;
  visualizationSettings: VisualizationSettings;
}
