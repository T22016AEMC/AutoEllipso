import {createKkBsplineModel} from '../models/kkBspline';
import {initializeDetectedPeaks,PeakInitialization} from '../models/peakInitialization';
/**
 * Model Registry / Optical Model Database
 * Central repository for all physics-based dispersion models.
 * Completely decouples optical modeling from UI components.
 */
import { ModelDefinition, ParameterValue, ModelType } from '../types/ellipsometry';
import { CauchyModel } from '../models/cauchy';
import { SellmeierModel } from '../models/sellmeier';
import { LorentzModel } from '../models/lorentz';
import { GaussianModel } from '../models/gaussian';
import { DrudeModel } from '../models/drude';
import { TaucLorentzModel } from '../models/taucLorentz';
import { CustomModel } from '../models/custom';
import { BSplineModel } from '../models/bspline';
import { MultiOscillatorModel } from '../models/multiOscillator';
import { ExpertMixedModel } from '../models/expertMixed';
import { TabulatedSiModel, TabulatedGlassModel, ConstantModel } from '../models/tabulated';

class ModelRegistry {
  private models: Map<string, ModelDefinition> = new Map();

  constructor() {
    this.register(CauchyModel);
    this.register(SellmeierModel);
    this.register(LorentzModel);
    this.register(GaussianModel);
    this.register(TaucLorentzModel);
    this.register(MultiOscillatorModel);
    this.register(ExpertMixedModel);
    this.register(DrudeModel);
    this.register(BSplineModel);
    this.register(createKkBsplineModel());
    this.register(CustomModel);
    this.register(TabulatedSiModel);
    this.register(TabulatedGlassModel);
    this.register(ConstantModel);
  }

  /**
   * Register a new model definition
   */
  register(model: ModelDefinition): void {
    this.models.set(model.id, model);
  }

  /**
   * Check if a model exists
   */
  has(id: string): boolean {
    return this.models.has(id);
  }

  /**
   * Retrieve a model definition by ID
   */
  get(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  /**
   * Get all registered models
   */
  getAll(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  /**
   * Get models by category / type
   */
  getModelsByType(type: ModelType): ModelDefinition[] {
    return this.getAll().filter((m) => m.type === type || m.category === type);
  }

  /**
   * Get models available for automated parameter fitting
   */
  getFittingModels(): ModelDefinition[] {
    return this.getAll().filter((m) => m.fitSupported);
  }

  /**
   * Preprocessing & baseline stage models (NOT final physical models)
   */
  getPreprocessingModels(): ModelDefinition[] {
    return this.getAll().filter((m) => m.id === 'cauchy' || m.id === 'bspline');
  }

  /**
   * User-selectable Final Physical Optical Models
   * Excludes preprocessing pipeline stages (Cauchy and B-spline) and substrates
   */
  getPhysicalModels(): ModelDefinition[] {
    return this.getAll().filter(
      (m) =>
        m.id === 'gaussian' ||
        m.id === 'lorentz' ||
        m.id === 'tauc_lorentz' ||
        m.id === 'drude' ||
        m.id === 'sellmeier' ||
        m.id === 'multi_oscillator' ||
        m.id === 'custom'
    );
  }

  /**
   * Get models suitable for thin film layers (excluding purely substrate tabulations)
   */
  getLayerModels(): ModelDefinition[] {
    return this.getAll().filter(
      (m) =>
        m.id === 'cauchy' ||
        m.id === 'sellmeier' ||
        m.id === 'lorentz' ||
        m.id === 'gaussian' ||
        m.id === 'tauc_lorentz' ||
        m.id === 'multi_oscillator' ||
        m.id === 'drude' ||
        m.id === 'bspline' ||
        m.id === 'kk_bspline' ||
        m.id === 'custom' ||
        m.id === 'constant_nk'
    );
  }

  /**
   * Get models suitable for substrates
   */
  getSubstrateModels(): ModelDefinition[] {
    return this.getAll().filter(
      (m) =>
        m.id === 'tabulated_si' ||
        m.id === 'tabulated_glass' ||
        m.id === 'constant_nk' ||
        m.id === 'cauchy' ||
        m.id === 'drude' ||
        m.id === 'lorentz' ||
        m.id === 'gaussian'
    );
  }

  /**
   * Instantiate a fresh set of ParameterValue instances for a given model
   */
  createParameterSet(modelId: string): Record<string, ParameterValue> {
    const model = this.get(modelId);
    if (!model) {
      console.warn(`[ModelRegistry] Unknown model ID: ${modelId}`);
      return {};
    }

    const params: Record<string, ParameterValue> = {};
    for (const p of model.parameters) {
      params[p.id] = {
        id: p.id,
        name: p.name,
        symbol: p.symbol,
        unit: p.unit,
        current: p.defaultValue,
        initial: p.defaultValue,
        min: p.min,
        max: p.max,
        fit: p.fitSupported ?? p.isFittingCandidate ?? false,
        fitSupported: p.fitSupported ?? true,
      };
    }
    return params;
  }

  /**
   * Physically initialize any selected optical model using the n(λ), k(λ) spectrum
   * extracted by the B-spline preprocessing step.
   *
   * Conducts real numerical feature extraction:
   * - High-frequency dielectric constant ε_∞ from long-wavelength asymptotic refractive index
   * - Peak absorption energy E0 from maximum ε2(E) = 2*n*k
   * - Natural spectral broadening (sigma / gamma / C) from peak FWHM
   * - Oscillator strength / amplitude A scaled to match peak dielectric absorption
   * - Bandgap Eg for Tauc-Lorentz from absorption onset threshold
   * - Plasma frequency wp for Drude from low-energy extinction rise
   */
  initializePhysicalModelFromBSpline(
    modelId: string,
    bsplineSpectrum: { wavelength: number; n: number; k: number }[],
    existingParams?: Record<string, ParameterValue>,
    options?:{maximum?:number;onInitialization?:(v:PeakInitialization)=>void}
  ): Record<string, ParameterValue> {
    const params = existingParams
      ? JSON.parse(JSON.stringify(existingParams))
      : this.createParameterSet(modelId);

    if (!bsplineSpectrum || bsplineSpectrum.length === 0) {
      return params;
    }

    const detected=initializeDetectedPeaks(modelId,bsplineSpectrum,params,this.get(modelId)!,options?.maximum??4);
    options?.onInitialization?.(detected.initialization);
    if(!detected.useLegacyFallback)return detected.parameters;

    const sorted=[...bsplineSpectrum].sort((a,b)=>a.wavelength-b.wavelength);
    const spectralData=sorted.map(p=>({...p,eps1:p.n*p.n-p.k*p.k}));
    const longWlPoints=spectralData.slice(-Math.max(1,Math.floor(spectralData.length*.15)));
    const shortWlPoints=spectralData.slice(0,Math.max(1,Math.floor(spectralData.length*.15)));
    const avgLongN=longWlPoints.reduce((s,p)=>s+p.n,0)/longWlPoints.length;
    const avgShortEps1=shortWlPoints.reduce((s,p)=>s+p.eps1,0)/shortWlPoints.length;
    const setParam=(key:string,value:number,fit=true)=>{const p=params[key];if(p){p.current=Math.max(p.min,Math.min(p.max,value));p.initial=p.current;p.fit=fit;}};
    switch(modelId) {
      case 'drude': {
        const epsInfEst = Math.max(1.1, Math.min(15.0, avgShortEps1));
        setParam('eps_inf', epsInfEst, true);
        const nirK = longWlPoints.reduce((acc, p) => acc + p.k, 0) / longWlPoints.length;
        const wpEst = Math.max(0.2, Math.min(9.0, Math.sqrt(Math.max(0.02, nirK * 6.0))));
        setParam('wp', wpEst, true);
        setParam('gamma', 0.25, true);
        break;
      }

      case 'sellmeier': {
        const midPoint = spectralData[Math.floor(spectralData.length / 2)] || { n: avgLongN };
        const b1Est = Math.max(0.2, midPoint.n * midPoint.n - 1.0);
        setParam('B1', b1Est, true);
        setParam('C1', 0.01, false);
        setParam('B2', 0.0, false);
        setParam('C2', 0.0, false);
        break;
      }

      default:
        break;
    }

    return params;
  }
}

// Global singleton instance
export const modelRegistry = new ModelRegistry();
