import {initializeDetectedPeaks,PeakInitialization} from '../models/peakInitialization';
/**
 * Model Registry / Optical Model Database
 * Central repository for all physics-based dispersion models.
 * Completely decouples optical modeling from UI components.
 */
import { ModelDefinition, ParameterValue, ModelType } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv } from '../models/base';
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

    // Sort by wavelength ascending
    const sorted = [...bsplineSpectrum].sort((a, b) => a.wavelength - b.wavelength);

    // Compute energies, eps1, eps2
    const spectralData = sorted.map((pt) => {
      const E = wavelengthNmToEnergyEv(pt.wavelength);
      const eps1 = pt.n * pt.n - pt.k * pt.k;
      const eps2 = 2 * pt.n * pt.k;
      return {
        wavelength: pt.wavelength,
        E,
        n: pt.n,
        k: pt.k,
        eps1,
        eps2,
      };
    });

    // 1. Estimate long-wavelength and short-wavelength dielectric response
    const longWlPoints = spectralData.slice(-Math.max(3, Math.floor(spectralData.length * 0.15)));
    const shortWlPoints = spectralData.slice(0, Math.max(3, Math.floor(spectralData.length * 0.15)));
    const avgLongN = longWlPoints.reduce((acc, p) => acc + p.n, 0) / longWlPoints.length;
    const avgLongEps1 = longWlPoints.reduce((acc, p) => acc + p.eps1, 0) / longWlPoints.length;
    const avgShortEps1 = shortWlPoints.reduce((acc, p) => acc + p.eps1, 0) / shortWlPoints.length;
    const maxEnergyEv = Math.max(...spectralData.map((p) => p.E));

    // 2. Find primary peak absorption in eps2 (or k)
    let peakEps2 = 0;
    let maxK = 0;
    let peakEnergyEv = 3.6;
    let peakIdx = 0;

    for (let i = 0; i < spectralData.length; i++) {
      if (spectralData[i].k > maxK) {
        maxK = spectralData[i].k;
      }
      if (spectralData[i].eps2 > peakEps2) {
        peakEps2 = spectralData[i].eps2;
        peakEnergyEv = spectralData[i].E;
        peakIdx = i;
      }
    }

    // Determine whether the film is predominantly transparent across the measured range
    const isTransparentDielectric = maxK < 0.035 && peakEps2 < 0.18;

    // Secondary peak detection (local maximum separated by at least 0.6 eV from peak 1)
    let peak2Eps2 = 0;
    let peak2EnergyEv = Math.min(8.5, peakEnergyEv + 1.2);
    for (let i = 1; i < spectralData.length - 1; i++) {
      const pt = spectralData[i];
      if (
        Math.abs(pt.E - peakEnergyEv) > 0.6 &&
        pt.eps2 > spectralData[i - 1].eps2 &&
        pt.eps2 > spectralData[i + 1].eps2 &&
        pt.eps2 > peak2Eps2
      ) {
        peak2Eps2 = pt.eps2;
        peak2EnergyEv = pt.E;
      }
    }

    // Tertiary peak detection
    let peak3Eps2 = 0;
    let peak3EnergyEv = Math.min(10.0, peak2EnergyEv + 1.0);
    for (let i = 1; i < spectralData.length - 1; i++) {
      const pt = spectralData[i];
      if (
        Math.abs(pt.E - peakEnergyEv) > 0.6 &&
        Math.abs(pt.E - peak2EnergyEv) > 0.6 &&
        pt.eps2 > spectralData[i - 1].eps2 &&
        pt.eps2 > spectralData[i + 1].eps2 &&
        pt.eps2 > peak3Eps2
      ) {
        peak3Eps2 = pt.eps2;
        peak3EnergyEv = pt.E;
      }
    }

    // 3. Estimate Full Width at Half Maximum (FWHM) around the primary peak
    const halfMax = peakEps2 * 0.5;
    let leftE = peakEnergyEv - 0.4;
    let rightE = peakEnergyEv + 0.4;

    for (let i = peakIdx - 1; i >= 0; i--) {
      if (spectralData[i].eps2 <= halfMax) {
        leftE = spectralData[i].E;
        break;
      }
    }
    for (let i = peakIdx + 1; i < spectralData.length; i++) {
      if (spectralData[i].eps2 <= halfMax) {
        rightE = spectralData[i].E;
        break;
      }
    }
    const fwhm = Math.max(0.2, Math.min(3.0, Math.abs(rightE - leftE)));

    // Helper to safely set parameter if it exists
    const setParam = (key: string, val: number, fit: boolean = true) => {
      if (params[key]) {
        const clamped = Math.max(params[key].min, Math.min(params[key].max, val));
        params[key].current = Number(clamped.toFixed(4));
        params[key].initial = params[key].current;
        params[key].fit = fit;
      }
    };

    const modelDef = this.get(modelId);

    // Helper: Given fixed oscillator shape parameters, solve for optimal (eps_inf, A) against B-spline spectrum
    const matchEpsInfAndAmplitude = (
      testRecord: Record<string, number>,
      ampKey: string = 'A'
    ): { epsInf: number; A: number; fitError: number } => {
      if (!modelDef) {
        return { epsInf: Math.max(1.0, avgLongEps1), A: 2.0, fitError: 1e9 };
      }
      // Evaluate unit-amplitude oscillator response: eps_osc(E) = eps(E; eps_inf=1, A=1) - (1, 0)
      const basis1: number[] = [];
      const basis2: number[] = [];
      for (const pt of spectralData) {
        const unitRec = { ...testRecord, eps_inf: 1.0, [ampKey]: 1.0, A2: 0, A3: 0 };
        const eps = modelDef.calculateEpsilon(pt.wavelength, unitRec);
        basis1.push(eps.eps1 - 1.0);
        basis2.push(eps.eps2);
      }

      // Linear least squares for:
      //   eps1_target(i) ≈ eps_inf + A * basis1(i)
      //   eps2_target(i) ≈ A * basis2(i)
      const nPts = spectralData.length;
      let s11 = nPts;
      let s12 = 0;
      let s22 = 0;
      let rhs1 = 0;
      let rhs2 = 0;

      for (let i = 0; i < nPts; i++) {
        const b1 = basis1[i];
        const b2 = basis2[i];
        const t1 = spectralData[i].eps1;
        const t2 = spectralData[i].eps2;
        s12 += b1;
        s22 += b1 * b1 + 2.5 * b2 * b2;
        rhs1 += t1;
        rhs2 += b1 * t1 + 2.5 * b2 * t2;
      }

      const det = s11 * s22 - s12 * s12;
      let estEpsInf = Math.max(1.0, avgLongEps1 - 0.4);
      let estA = 2.0;

      if (Math.abs(det) > 1e-9) {
        estEpsInf = (s22 * rhs1 - s12 * rhs2) / det;
        estA = (s11 * rhs2 - s12 * rhs1) / det;
      }

      const minA = params[ampKey]?.min ?? 0.05;
      const maxA = params[ampKey]?.max ?? 100.0;
      estA = Math.max(minA, Math.min(maxA, estA));

      // Re-solve optimal eps_inf given clamped estA
      const meanResidualEps1 =
        spectralData.reduce((acc, pt, i) => acc + (pt.eps1 - estA * basis1[i]), 0) / nPts;
      const minEpsInf = params['eps_inf']?.min ?? 1.0;
      const maxEpsInf = params['eps_inf']?.max ?? 15.0;
      estEpsInf = Math.max(minEpsInf, Math.min(maxEpsInf, meanResidualEps1));

      let err = 0;
      for (let i = 0; i < nPts; i++) {
        const e1 = estEpsInf + estA * basis1[i] - spectralData[i].eps1;
        const e2 = estA * basis2[i] - spectralData[i].eps2;
        err += e1 * e1 + 2.0 * e2 * e2;
      }

      return { epsInf: estEpsInf, A: estA, fitError: err / nPts };
    };

    switch (modelId) {
      case 'gaussian': {
        if (isTransparentDielectric) {
          // Search VUV resonance poles above maxEnergyEv so k(λ) ≈ 0 and normal dispersion matches B-spline n(λ)
          let bestPole = { E0: Math.max(8.5, maxEnergyEv + 3.0), sigma: 0.55, epsInf: 1.35, A: 10.0, err: 1e9 };
          const candidateE0s = [
            maxEnergyEv + 1.8,
            maxEnergyEv + 2.6,
            maxEnergyEv + 3.5,
            maxEnergyEv + 4.3,
            maxEnergyEv + 5.2,
          ];
          const candidateSigmas = [0.35, 0.55, 0.8];
          for (const cE0 of candidateE0s) {
            for (const cSigma of candidateSigmas) {
              const m = matchEpsInfAndAmplitude({ E0: cE0, sigma: cSigma }, 'A');
              if (m.fitError < bestPole.err) {
                bestPole = { E0: cE0, sigma: cSigma, epsInf: m.epsInf, A: m.A, err: m.fitError };
              }
            }
          }
          setParam('eps_inf', bestPole.epsInf, true);
          setParam('A', bestPole.A, true);
          setParam('E0', bestPole.E0, true);
          setParam('sigma', bestPole.sigma, true);
          setParam('A2', 0.0, false);
          setParam('E02', Math.min(14.0, bestPole.E0 + 1.5), false);
          setParam('sigma2', 0.6, false);
          setParam('A3', 0.0, false);
          setParam('E03', Math.min(14.5, bestPole.E0 + 2.5), false);
          setParam('sigma3', 0.7, false);
        } else {
          const sigma1 = Math.max(0.15, Math.min(2.5, fwhm / 1.665));
          const E01 = Math.max(1.0, Math.min(12.0, peakEnergyEv));
          const matched = matchEpsInfAndAmplitude({ E0: E01, sigma: sigma1 }, 'A');
          setParam('eps_inf', matched.epsInf, true);
          setParam('A', Math.max(0.1, matched.A), true);
          setParam('E0', E01, true);
          setParam('sigma', sigma1, true);

          if (peak2Eps2 > 0.15 * peakEps2) {
            setParam('A2', Math.max(0.1, peak2Eps2 * 1.1), true);
            setParam('E02', Math.max(1.0, Math.min(14.0, peak2EnergyEv)), true);
            setParam('sigma2', Math.max(0.2, sigma1 * 0.9), true);
          } else {
            setParam('A2', 0.0, false);
            setParam('E02', Math.min(14.0, E01 + 1.2), false);
            setParam('sigma2', 0.6, false);
          }

          if (peak3Eps2 > 0.15 * peakEps2) {
            setParam('A3', Math.max(0.1, peak3Eps2 * 1.0), true);
            setParam('E03', Math.max(1.0, Math.min(14.5, peak3EnergyEv)), true);
            setParam('sigma3', Math.max(0.2, sigma1 * 1.1), true);
          } else {
            setParam('A3', 0.0, false);
            setParam('E03', Math.min(14.5, peak2EnergyEv + 1.0), false);
            setParam('sigma3', 0.7, false);
          }
        }
        break;
      }

      case 'lorentz': {
        if (isTransparentDielectric) {
          let bestPole = { E0: Math.max(8.8, maxEnergyEv + 3.2), gamma: 0.01, epsInf: 1.35, A: 8.0, err: 1e9 };
          const candidateE0s = [
            maxEnergyEv + 1.8,
            maxEnergyEv + 2.8,
            maxEnergyEv + 3.8,
            maxEnergyEv + 4.8,
          ];
          const candidateGammas = [0.005, 0.015, 0.05];
          for (const cE0 of candidateE0s) {
            for (const cGamma of candidateGammas) {
              const m = matchEpsInfAndAmplitude({ E0: cE0, gamma: cGamma }, 'A');
              if (m.fitError < bestPole.err) {
                bestPole = { E0: cE0, gamma: cGamma, epsInf: m.epsInf, A: m.A, err: m.fitError };
              }
            }
          }
          setParam('eps_inf', bestPole.epsInf, true);
          setParam('A', bestPole.A, true);
          setParam('E0', bestPole.E0, true);
          setParam('gamma', bestPole.gamma, true);
          setParam('A2', 0.0, false);
          setParam('E02', Math.min(14.0, bestPole.E0 + 1.5), false);
          setParam('gamma2', 0.2, false);
          setParam('A3', 0.0, false);
          setParam('E03', Math.min(14.5, bestPole.E0 + 2.5), false);
          setParam('gamma3', 0.3, false);
        } else {
          const gamma = Math.max(0.1, Math.min(2.5, fwhm));
          const E01 = Math.max(1.0, Math.min(12.0, peakEnergyEv));
          const matched = matchEpsInfAndAmplitude({ E0: E01, gamma }, 'A');
          setParam('eps_inf', matched.epsInf, true);
          setParam('A', Math.max(0.2, matched.A), true);
          setParam('E0', E01, true);
          setParam('gamma', gamma, true);

          if (peak2Eps2 > 0.15 * peakEps2) {
            setParam('A2', Math.max(0.2, peak2Eps2 * gamma * 1.3), true);
            setParam('E02', Math.max(1.0, Math.min(14.0, peak2EnergyEv)), true);
            setParam('gamma2', Math.max(0.1, gamma * 0.9), true);
          } else {
            setParam('A2', 0.0, false);
            setParam('E02', Math.min(14.0, E01 + 1.2), false);
            setParam('gamma2', 0.5, false);
          }

          if (peak3Eps2 > 0.15 * peakEps2) {
            setParam('A3', Math.max(0.2, peak3Eps2 * gamma * 1.1), true);
            setParam('E03', Math.max(1.0, Math.min(14.5, peak3EnergyEv)), true);
            setParam('gamma3', Math.max(0.1, gamma * 1.1), true);
          } else {
            setParam('A3', 0.0, false);
            setParam('E03', Math.min(14.5, peak2EnergyEv + 1.0), false);
            setParam('gamma3', 0.6, false);
          }
        }
        break;
      }

      case 'tauc_lorentz': {
        if (isTransparentDielectric) {
          const egPole = Math.max(6.6, maxEnergyEv + 0.3);
          let bestPole = { E0: egPole + 3.0, C: 1.2, Eg: egPole, epsInf: 1.35, A: 90.0, err: 1e9 };
          for (const dE0 of [2.0, 3.0, 4.0]) {
            for (const cVal of [1.0, 1.5]) {
              const cE0 = egPole + dE0;
              const m = matchEpsInfAndAmplitude({ E0: cE0, C: cVal, Eg: egPole }, 'A');
              if (m.fitError < bestPole.err) {
                bestPole = { E0: cE0, C: cVal, Eg: egPole, epsInf: m.epsInf, A: m.A, err: m.fitError };
              }
            }
          }
          setParam('eps_inf', bestPole.epsInf, true);
          setParam('A', bestPole.A, true);
          setParam('E0', bestPole.E0, true);
          setParam('C', bestPole.C, true);
          setParam('Eg', bestPole.Eg, true);
          setParam('A2', 0.0, false);
          setParam('E02', Math.min(14.0, bestPole.E0 + 1.5), false);
          setParam('C2', 1.5, false);
          setParam('A3', 0.0, false);
          setParam('E03', Math.min(14.5, bestPole.E0 + 2.5), false);
          setParam('C3', 1.8, false);
        } else {
          const broadeningC = Math.max(0.3, Math.min(3.5, fwhm));
          let egEst = Math.max(0.5, peakEnergyEv - broadeningC * 0.6);
          // Scan from low energy to high energy to detect absorption onset
          const byEnergyAsc = [...spectralData].sort((a, b) => a.E - b.E);
          for (let i = 0; i < byEnergyAsc.length; i++) {
            if (byEnergyAsc[i].k > 0.025 && byEnergyAsc[i].E < peakEnergyEv) {
              egEst = Math.max(0.5, byEnergyAsc[i].E - 0.15);
              break;
            }
          }
          const clampedEg = Math.max(0.4, Math.min(peakEnergyEv - 0.2, egEst));
          const E01 = Math.max(clampedEg + 0.25, Math.min(12.0, peakEnergyEv));

          // Grid search around (E01, broadeningC, clampedEg) to find best least-squares match to B-spline
          let bestTL = {
            E0: E01,
            C: broadeningC,
            Eg: clampedEg,
            epsInf: 1.8,
            A: Math.max(15.0, peakEps2 * 40.0),
            err: 1e9,
          };
          for (const dE0 of [-0.2, 0.0, 0.2]) {
            for (const cScale of [0.75, 1.0, 1.25]) {
              for (const dEg of [-0.15, 0.0, 0.15]) {
                const testEg = Math.max(0.3, clampedEg + dEg);
                const testE0 = Math.max(testEg + 0.2, E01 + dE0);
                const testC = Math.max(0.2, broadeningC * cScale);
                const m = matchEpsInfAndAmplitude({ E0: testE0, C: testC, Eg: testEg }, 'A');
                if (m.fitError < bestTL.err) {
                  bestTL = { E0: testE0, C: testC, Eg: testEg, epsInf: m.epsInf, A: m.A, err: m.fitError };
                }
              }
            }
          }

          setParam('eps_inf', bestTL.epsInf, true);
          setParam('Eg', bestTL.Eg, true);
          setParam('E0', bestTL.E0, true);
          setParam('C', bestTL.C, true);
          setParam('A', bestTL.A, true);

          if (peak2Eps2 > 0.15 * peakEps2) {
            setParam('A2', Math.max(10.0, peak2Eps2 * 40.0), true);
            setParam('E02', Math.max(bestTL.Eg + 0.4, Math.min(14.0, peak2EnergyEv)), true);
            setParam('C2', Math.max(0.3, bestTL.C * 1.1), true);
          } else {
            setParam('A2', 0.0, false);
            setParam('E02', Math.min(14.0, bestTL.E0 + 1.2), false);
            setParam('C2', 1.8, false);
          }

          if (peak3Eps2 > 0.15 * peakEps2) {
            setParam('A3', Math.max(10.0, peak3Eps2 * 35.0), true);
            setParam('E03', Math.max(bestTL.Eg + 0.4, Math.min(14.5, peak3EnergyEv)), true);
            setParam('C3', Math.max(0.3, bestTL.C * 1.2), true);
          } else {
            setParam('A3', 0.0, false);
            setParam('E03', Math.min(14.5, peak2EnergyEv + 1.0), false);
            setParam('C3', 2.0, false);
          }
        }
        break;
      }

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

      case 'multi_oscillator': {
        const e0Init = isTransparentDielectric ? Math.max(8.5, maxEnergyEv + 2.5) : Math.max(1.2, Math.min(8.0, peakEnergyEv));
        const w1Init = isTransparentDielectric ? 0.05 : Math.max(0.2, fwhm);
        const matched = matchEpsInfAndAmplitude({ E01: e0Init, w1: w1Init }, 'A1');
        setParam('eps_inf', matched.epsInf, true);
        setParam('A1', Math.max(0.5, matched.A), true);
        setParam('E01', e0Init, true);
        setParam('w1', w1Init, true);

        let osc2Energy = e0Init > 5.0 ? 4.2 : 5.5;
        setParam('A2', isTransparentDielectric ? 0.1 : Math.max(0.1, peakEps2 * 0.4), !isTransparentDielectric);
        setParam('E02', osc2Energy, !isTransparentDielectric);
        setParam('w2', 0.6, !isTransparentDielectric);

        setParam('A3', 0.0, false);
        setParam('E03', 6.5, false);
        setParam('w3', 0.8, false);
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
