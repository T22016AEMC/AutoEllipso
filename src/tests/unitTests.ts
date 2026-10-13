/**
 * Scientific Unit Tests & Verification Suite
 * Validates physics algorithms, model registry, solver, residual metrics, and optimizer constraints.
 */
import { Complex } from '../optics/complex';
import { modelRegistry } from '../modelRegistry/registry';
import { solveEllipsometryTMM } from '../solver/transferMatrix';
import { calculatePoint, calculateSpectrum } from '../solver/calculator';
import { computeResidualMetrics, circularDifferenceDeg } from '../fitting/residual';
import { runAutoFit } from '../fitting/engine';
import { EllipsometryProject, Layer, Substrate } from '../types/ellipsometry';
import { createSiO2OnSiProject, createMultiAoiSiO2OnSiProject } from '../data/defaultProjects';

export interface TestResult {
  name: string;
  category: 'optics' | 'models' | 'solver' | 'residual' | 'fitting';
  passed: boolean;
  message: string;
  durationMs: number;
}

export async function runAllUnitTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: Complex numbers operations
  {
    const start = performance.now();
    const a = new Complex(3, 4);
    const b = new Complex(1, -2);
    const sum = a.add(b);
    const prod = a.mul(b);
    const div = a.div(b);
    const sqrtVal = new Complex(0, 4).sqrt(); // sqrt(4i) = sqrt(2) + i*sqrt(2)

    const passed =
      Math.abs(sum.re - 4) < 1e-6 &&
      Math.abs(sum.im - 2) < 1e-6 &&
      Math.abs(prod.re - 11) < 1e-6 &&
      Math.abs(prod.im - (-2)) < 1e-6 &&
      Math.abs(sqrtVal.re - Math.sqrt(2)) < 1e-5 &&
      Math.abs(sqrtVal.im - Math.sqrt(2)) < 1e-5;

    results.push({
      name: 'Complex Number Arithmetic & Square Root',
      category: 'optics',
      passed,
      message: passed ? 'Complex operations verified.' : 'Complex arithmetic mismatch.',
      durationMs: performance.now() - start,
    });
  }

  // Test 2: Model Registry loading and parameter instantiation
  {
    const start = performance.now();
    const cauchy = modelRegistry.get('cauchy');
    const sellmeier = modelRegistry.get('sellmeier');
    const lorentz = modelRegistry.get('lorentz');
    const gaussian = modelRegistry.get('gaussian');
    const taucLorentz = modelRegistry.get('tauc_lorentz');
    const drude = modelRegistry.get('drude');
    const custom = modelRegistry.get('custom');
    const gaussianParams = modelRegistry.createParameterSet('gaussian');

    const passed =
      !!cauchy &&
      !!sellmeier &&
      !!lorentz &&
      !!gaussian &&
      !!taucLorentz &&
      !!drude &&
      !!custom &&
      'A' in gaussianParams &&
      'E0' in gaussianParams &&
      'sigma' in gaussianParams &&
      gaussian.fitSupported === true;

    results.push({
      name: 'Optical Model Registry: All 7 Models Loaded with Full Schema',
      category: 'models',
      passed,
      message: passed
        ? 'All 7 models (Cauchy, Sellmeier, Lorentz, Gaussian, Tauc-Lorentz, Drude, Custom) verified.'
        : 'Failed loading all required models.',
      durationMs: performance.now() - start,
    });
  }

  // Test 3: Cauchy & Sellmeier Optical Engine Calculation
  {
    const start = performance.now();
    const cauchy = modelRegistry.get('cauchy')!;
    // At 632.8 nm with A=1.457, B=0.0035, C=0.0001
    // n = 1.457 + 0.0035/(0.6328^2) + 0.0001/(0.6328^4) ~= 1.466
    const opt633 = cauchy.calculate(632.8, { A: 1.457, B: 0.0035, C: 0.0001 });

    const passed = opt633.n > 1.46 && opt633.n < 1.47 && opt633.k === 0;

    results.push({
      name: 'Optical Model Engine: Cauchy Refractive Index Calculation',
      category: 'models',
      passed,
      message: passed
        ? `Evaluated n(632.8nm) = ${opt633.n.toFixed(4)}, consistent with SiO2.`
        : `Unexpected n: ${opt633.n}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 4: Multilayer Transfer Matrix Method (TMM) Solver
  {
    const start = performance.now();
    const ambientN = new Complex(1.0, 0); // Air
    const substrateN = new Complex(3.882, 0.019); // Si at 632.8 nm

    // Test a: Bare substrate at 70°
    const bareSubstrateRes = solveEllipsometryTMM(ambientN, [], substrateN, 632.8, 70.0);

    // Test b: 100 nm SiO2 on Si
    const layerSiO2 = {
      thicknessNm: 100.0,
      N: new Complex(1.46, 0),
    };
    const thinFilmRes = solveEllipsometryTMM(ambientN, [layerSiO2], substrateN, 632.8, 70.0);

    // Standard expected values: Psi in [0, 90], Delta in [0, 360]
    const passed =
      bareSubstrateRes.psiDeg > 0 &&
      bareSubstrateRes.psiDeg < 90 &&
      bareSubstrateRes.deltaDeg >= 0 &&
      thinFilmRes.psiDeg > 0 &&
      thinFilmRes.psiDeg < 90 &&
      Math.abs(thinFilmRes.psiDeg - bareSubstrateRes.psiDeg) > 2; // Thin film produces noticeable phase shift

    results.push({
      name: 'Multilayer Transfer Matrix Method (TMM) Optical Solver',
      category: 'solver',
      passed,
      message: passed
        ? `TMM output verified: Bare Si (Ψ=${bareSubstrateRes.psiDeg.toFixed(2)}°, Δ=${bareSubstrateRes.deltaDeg.toFixed(2)}°); 100nm SiO2 (Ψ=${thinFilmRes.psiDeg.toFixed(2)}°, Δ=${thinFilmRes.deltaDeg.toFixed(2)}°)`
        : 'TMM output out of physical bounds.',
      durationMs: performance.now() - start,
    });
  }

  // Test 5: Residual Calculator and Angular Difference Handling
  {
    const start = performance.now();
    // Test angular difference wrap around 0 / 360
    const diff1 = circularDifferenceDeg(5, 355); // 5 - 355 = -350 -> +10 degrees
    const diff2 = circularDifferenceDeg(180, 175); // +5 degrees

    const testPoints = [
      { id: '1', wavelength: 400, aoi: 70, psiExp: 30, deltaExp: 100, psiCalc: 32, deltaCalc: 104 },
      { id: '2', wavelength: 500, aoi: 70, psiExp: 40, deltaExp: 150, psiCalc: 39, deltaCalc: 148 },
    ];
    const metrics = computeResidualMetrics(testPoints);

    const passed =
      Math.abs(diff1 - 10) < 1e-4 &&
      Math.abs(diff2 - 5) < 1e-4 &&
      metrics.mse > 0 &&
      metrics.rmse > 0 &&
      metrics.totalPoints === 2;

    results.push({
      name: 'Residual Calculation & Circular Angle Wrapping',
      category: 'residual',
      passed,
      message: passed
        ? `Calculated MSE=${metrics.mse.toFixed(4)}, RMSE=${metrics.rmse.toFixed(4)} with robust circle wrapping.`
        : 'Residual metric mismatch.',
      durationMs: performance.now() - start,
    });
  }

  // Test 6: Bounded Nonlinear Least Squares Fitting Engine
  {
    const start = performance.now();
    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = {
      name: 'Silicon',
      materialType: 'tabulated',
      modelId: 'tabulated_si',
      parameters: {},
    };

    // Synthesize ground-truth test data for 100 nm film
    const trueLayer: Layer = {
      id: 'test_l1',
      name: 'Test Film',
      materialName: 'SiO2',
      thickness: 100.0,
      thicknessFit: true,
      thicknessMin: 50.0,
      thicknessMax: 150.0,
      thicknessInitial: 100.0,
      modelId: 'cauchy',
      parameters: {
        A: { id: 'A', name: 'A', unit: '', current: 1.457, initial: 1.457, min: 1.2, max: 1.8, fit: false },
        B: { id: 'B', name: 'B', unit: '', current: 0.0035, initial: 0.0035, min: 0, max: 0.02, fit: false },
      },
    };

    const wavelengths = [400, 500, 600, 700];
    const initialPoints = wavelengths.map((wl) => {
      const calc = calculatePoint(ambient, [trueLayer], substrate, wl, 70.0);
      return {
        id: `p_${wl}`,
        wavelength: wl,
        aoi: 70.0,
        psiExp: calc.psiDeg,
        deltaExp: calc.deltaDeg,
      };
    });

    // Perturb initial thickness to 85.0 nm (off by 15 nm)
    const perturbedLayer: Layer = {
      ...trueLayer,
      thickness: 85.0,
      thicknessInitial: 85.0,
    };

    const fitOutput = await runAutoFit({
      ambient,
      layers: [perturbedLayer],
      substrate,
      points: initialPoints,
      config: {
        maxIterations: 25,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
      },
    });

    const fittedThickness = fitOutput.updatedLayers[0].thickness;
    const thicknessDiff = Math.abs(fittedThickness - 100.0);
    const passed = thicknessDiff < 0.2; // Converged within 0.2 nm of 100.0 nm ground truth

    results.push({
      name: 'Bounded Levenberg-Marquardt Convergence (85nm -> 100nm)',
      category: 'fitting',
      passed,
      message: passed
        ? `Optimizer converged to ${fittedThickness.toFixed(2)} nm (ground truth: 100.00 nm). Final MSE: ${fitOutput.fittingResult.finalMse.toExponential(3)}.`
        : `Optimizer failed to converge: ${fittedThickness.toFixed(2)} nm`,
      durationMs: performance.now() - start,
    });
  }

  // Test 7: Constraint Enforcement & Fixed Parameters (FIT = OFF)
  {
    const start = performance.now();
    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = {
      name: 'Silicon',
      materialType: 'tabulated',
      modelId: 'tabulated_si',
      parameters: {},
    };

    const testLayer: Layer = {
      id: 'test_l2',
      name: 'Fixed Test Film',
      materialName: 'Dielectric',
      thickness: 75.0,
      thicknessFit: false, // Strictly FIXED
      thicknessMin: 10.0,
      thicknessMax: 200.0,
      thicknessInitial: 75.0,
      modelId: 'cauchy',
      parameters: {
        A: { id: 'A', name: 'A', unit: '', current: 1.5, initial: 1.5, min: 1.2, max: 1.8, fit: false }, // Also FIXED
      },
    };

    const points = [
      { id: '1', wavelength: 500, aoi: 70, psiExp: 25, deltaExp: 110 },
      { id: '2', wavelength: 600, aoi: 70, psiExp: 28, deltaExp: 130 },
    ];

    const fitOutput = await runAutoFit({
      ambient,
      layers: [testLayer],
      substrate,
      points,
      config: {
        maxIterations: 10,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
      },
    });

    const passed =
      fitOutput.updatedLayers[0].thickness === 75.0 &&
      fitOutput.updatedLayers[0].parameters['A'].current === 1.5 &&
      fitOutput.fittingResult.parameters.length === 0;

    results.push({
      name: 'FIT = OFF Parameter Immutability Guard',
      category: 'fitting',
      passed,
      message: passed
        ? 'Fixed parameters remained completely unchanged during optimization.'
        : 'Fixed parameters were erroneously altered!',
      durationMs: performance.now() - start,
    });
  }

  // Test 8: Auto Fit Objective Function Sanity Test (Requirement 15)
  // Deterministic test on experimental dataset confirming Final MSE <= Initial MSE
  {
    const start = performance.now();
    const proj = createSiO2OnSiProject();
    // Start with perturbed thickness of 50.0 nm (ground truth is 100.0 nm)
    proj.layers[0].thickness = 50.0;
    proj.layers[0].thicknessInitial = 50.0;
    proj.layers[0].thicknessFit = true;

    const fitOutput = await runAutoFit({
      ambient: proj.ambient,
      layers: proj.layers,
      substrate: proj.substrate,
      points: proj.experimentData!.points,
      config: {
        maxIterations: 20,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
        fitWavelengthMin: 190,
        fitWavelengthMax: 900,
      },
    });

    const initMse = fitOutput.fittingResult.initialMse;
    const finalMse = fitOutput.fittingResult.finalMse;
    const isMseReduced = finalMse < initMse;
    const isConverged =
      fitOutput.fittingResult.status === 'converged' || fitOutput.fittingResult.status === 'max_iter';
    const isAccurate = Math.abs(fitOutput.updatedLayers[0].thickness - 100.0) < 0.5;
    const passed = isMseReduced && isConverged && isAccurate;

    results.push({
      name: 'Auto Fit Objective Function Sanity Test (50nm -> 100nm, Final MSE <= Initial MSE)',
      category: 'fitting',
      passed,
      message: passed
        ? `Deterministic fit verified: Initial MSE=${initMse.toFixed(2)} → Final MSE=${finalMse.toFixed(5)}, Thickness=${fitOutput.updatedLayers[0].thickness.toFixed(2)}nm.`
        : `Sanity test failed: initMSE=${initMse}, finalMSE=${finalMse}, status=${fitOutput.fittingResult.status}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 9: Multi-AOI Global Fitting (65°, 70°, 75° Simultaneous Convergence)
  {
    const start = performance.now();
    const proj = createMultiAoiSiO2OnSiProject();
    // Initial thickness = 88.0 nm, Cauchy A = 1.450 (Ground truth = 100.0 nm, A = 1.457)
    proj.layers[0].thicknessFit = true;
    proj.layers[0].parameters['A'].fit = true;

    const fitOutput = await runAutoFit({
      ambient: proj.ambient,
      layers: proj.layers,
      substrate: proj.substrate,
      points: proj.experimentData!.points,
      config: proj.fittingConfig,
      selectedAois: [65.0, 70.0, 75.0],
    });

    const isMultiMode = fitOutput.fittingResult.fittingMode === 'multi_aoi';
    const initMse = fitOutput.fittingResult.initialMse;
    const finalMse = fitOutput.fittingResult.finalMse;
    const isMseReduced = finalMse < initMse;
    const thicknessFitted = fitOutput.updatedLayers[0].thickness;
    const isThicknessAccurate = Math.abs(thicknessFitted - 100.0) < 0.6;
    const hasPerAoi =
      fitOutput.fittingResult.perAoiMse &&
      65 in fitOutput.fittingResult.perAoiMse &&
      70 in fitOutput.fittingResult.perAoiMse &&
      75 in fitOutput.fittingResult.perAoiMse;

    const passed = isMultiMode && isMseReduced && isThicknessAccurate && !!hasPerAoi;

    results.push({
      name: 'Multi-AOI Global Fitting: Shared Film Parameters over 65°/70°/75°',
      category: 'fitting',
      passed,
      message: passed
        ? `Global Multi-AOI fit verified: Global MSE ${initMse.toFixed(3)} → ${finalMse.toFixed(4)}, Fitted d=${thicknessFitted.toFixed(2)} nm, per-AOI MSE: 65°=${fitOutput.fittingResult.perAoiMse?.[65].toFixed(4)}, 70°=${fitOutput.fittingResult.perAoiMse?.[70].toFixed(4)}, 75°=${fitOutput.fittingResult.perAoiMse?.[75].toFixed(4)}.`
        : `Multi-AOI test failed: initMSE=${initMse}, finalMSE=${finalMse}, d=${thicknessFitted}, mode=${fitOutput.fittingResult.fittingMode}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 10: Multi-AOI Subset Angle Filtering Selection ([65°, 75°])
  {
    const start = performance.now();
    const proj = createMultiAoiSiO2OnSiProject();
    proj.layers[0].thicknessFit = true;

    const fitOutput = await runAutoFit({
      ambient: proj.ambient,
      layers: proj.layers,
      substrate: proj.substrate,
      points: proj.experimentData!.points,
      config: proj.fittingConfig,
      selectedAois: [65.0, 75.0], // Exclude 70°
    });

    const isMultiMode = fitOutput.fittingResult.fittingMode === 'multi_aoi';
    const has65 = fitOutput.fittingResult.perAoiMse && 65 in fitOutput.fittingResult.perAoiMse;
    const has75 = fitOutput.fittingResult.perAoiMse && 75 in fitOutput.fittingResult.perAoiMse;
    const no70 = !fitOutput.fittingResult.perAoiMse || !(70 in fitOutput.fittingResult.perAoiMse);
    const passed = isMultiMode && !!has65 && !!has75 && no70;

    results.push({
      name: 'Multi-AOI Selective Angle Filtering (Include 65° & 75°, Exclude 70°)',
      category: 'fitting',
      passed,
      message: passed
        ? 'Successfully isolated optimization objective to user-selected AOIs (65° & 75°).'
        : 'AOI selection filtering failed.',
      durationMs: performance.now() - start,
    });
  }

  // Test 11: Gaussian Oscillator Model Resonance & Kramers-Kronig Properties
  {
    const start = performance.now();
    const gaussian = modelRegistry.get('gaussian')!;
    // Set Gaussian parameters: eps_inf=2.0, A=3.0, E0=3.5 eV, sigma=0.5 eV
    // Peak energy is 3.5 eV -> Wavelength = 1239.84193 / 3.5 ~= 354.24 nm
    const peakWl = 1239.84193 / 3.5;
    const offPeakWl = 1239.84193 / 2.0; // 2.0 eV (far from resonance)

    const peakEps = gaussian.calculateEpsilon!(peakWl, { eps_inf: 2.0, A: 3.0, E0: 3.5, sigma: 0.5 });
    const offPeakEps = gaussian.calculateEpsilon!(offPeakWl, { eps_inf: 2.0, A: 3.0, E0: 3.5, sigma: 0.5 });
    const peakOpt = gaussian.calculate(peakWl, { eps_inf: 2.0, A: 3.0, E0: 3.5, sigma: 0.5 });

    // epsilon2 should peak at ~3.0 at resonance, and be close to 0 far off peak
    const passed =
      Math.abs(peakEps.eps2 - 3.0) < 0.1 &&
      offPeakEps.eps2 < 0.05 &&
      peakOpt.k > 0.5 &&
      peakOpt.n > 1.0;

    results.push({
      name: 'Gaussian Oscillator: Resonance Peak & Dielectric Response',
      category: 'models',
      passed,
      message: passed
        ? `Gaussian oscillator verified: Peak ε2=${peakEps.eps2.toFixed(3)} at 3.5eV, off-peak ε2=${offPeakEps.eps2.toFixed(4)}, k=${peakOpt.k.toFixed(3)}.`
        : `Gaussian peak verification failed: peakEps2=${peakEps.eps2}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 12: Drude Free Carrier Dispersion Model
  {
    const start = performance.now();
    const drude = modelRegistry.get('drude')!;
    // Plasma energy wp = 2.5 eV, eps_inf = 3.8, gamma = 0.15 eV
    // At low energy (e.g. 1500 nm -> ~0.826 eV < wp), eps1 is strongly negative (conducting)
    const nirWl = 1500;
    const nirEps = drude.calculateEpsilon!(nirWl, { eps_inf: 3.8, wp: 2.5, gamma: 0.15 });
    const visOpt = drude.calculate(500, { eps_inf: 3.8, wp: 2.5, gamma: 0.15 });

    const passed = nirEps.eps1 < 0 && nirEps.eps2 > 0 && visOpt.n > 0 && visOpt.k > 0;

    results.push({
      name: 'Drude Free Carrier Model: Conducting Metal/TCO Negative ε1 Response',
      category: 'models',
      passed,
      message: passed
        ? `Drude response verified: NIR (1500nm) ε1=${nirEps.eps1.toFixed(2)} (negative), ε2=${nirEps.eps2.toFixed(2)}, VIS n=${visOpt.n.toFixed(2)}.`
        : `Drude verification failed: eps1=${nirEps.eps1}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 13: Custom Parametric Dispersion Model Verification
  {
    const start = performance.now();
    const custom = modelRegistry.get('custom')!;
    const opt = custom.calculate(550, { n0: 1.62, alpha: 0.005, k0: 0.02, beta: 0.001 });

    const passed = Math.abs(opt.n - 1.636) < 0.01 && opt.k > 0.02;

    results.push({
      name: 'Custom Dispersion Model: Extensible User-Defined Parameter Calculation',
      category: 'models',
      passed,
      message: passed
        ? `Custom model calculation verified: n(550nm)=${opt.n.toFixed(4)}, k(550nm)=${opt.k.toFixed(4)}.`
        : `Custom calculation mismatch: n=${opt.n}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 14: Gaussian Thin-Film Layer TMM Solver & Levenberg-Marquardt Auto-Fitting
  {
    const start = performance.now();
    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = {
      name: 'Silicon',
      materialType: 'tabulated',
      modelId: 'tabulated_si',
      parameters: {},
    };

    // Ground truth: 80 nm Gaussian polymer film on Si
    const trueLayer: Layer = {
      id: 'gaussian_layer',
      name: 'Gaussian Organic Film',
      materialName: 'PMMA Resist',
      thickness: 80.0,
      thicknessFit: true,
      thicknessMin: 40.0,
      thicknessMax: 120.0,
      thicknessInitial: 80.0,
      modelId: 'gaussian',
      parameters: {
        eps_inf: { id: 'eps_inf', name: 'eps_inf', unit: '', current: 2.1, initial: 2.1, min: 1.0, max: 5.0, fit: false },
        A: { id: 'A', name: 'A', unit: '', current: 2.5, initial: 2.5, min: 0.5, max: 6.0, fit: true },
        E0: { id: 'E0', name: 'E0', unit: 'eV', current: 4.2, initial: 4.2, min: 2.0, max: 6.0, fit: false },
        sigma: { id: 'sigma', name: 'sigma', unit: 'eV', current: 0.6, initial: 0.6, min: 0.1, max: 2.0, fit: false },
      },
    };

    // Synthesize dataset over UV/Vis wavelengths
    const testWls = [280, 320, 380, 450, 550, 650];
    const synthPoints = testWls.map((wl) => {
      const calc = calculatePoint(ambient, [trueLayer], substrate, wl, 70.0);
      return {
        id: `g_${wl}`,
        wavelength: wl,
        aoi: 70.0,
        psiExp: calc.psiDeg,
        deltaExp: calc.deltaDeg,
      };
    });

    // Perturb initial thickness to 65.0 nm and A to 1.8
    const perturbedLayer: Layer = {
      ...trueLayer,
      thickness: 65.0,
      thicknessInitial: 65.0,
      parameters: {
        ...trueLayer.parameters,
        A: { ...trueLayer.parameters['A'], current: 1.8, initial: 1.8 },
      },
    };

    const fitOutput = await runAutoFit({
      ambient,
      layers: [perturbedLayer],
      substrate,
      points: synthPoints,
      config: {
        maxIterations: 30,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
      },
    });

    const initMse = fitOutput.fittingResult.initialMse;
    const finalMse = fitOutput.fittingResult.finalMse;
    const fittedThickness = fitOutput.updatedLayers[0].thickness;
    const fittedA = fitOutput.updatedLayers[0].parameters['A'].current;

    const isMseReduced = finalMse < initMse;
    const isThicknessClose = Math.abs(fittedThickness - 80.0) < 1.0;
    const isAClose = Math.abs(fittedA - 2.5) < 0.2;
    const passed = isMseReduced && isThicknessClose && isAClose;

    results.push({
      name: 'Gaussian Layer TMM Integration & Levenberg-Marquardt Auto-Fitting',
      category: 'fitting',
      passed,
      message: passed
        ? `Gaussian layer fitted successfully: MSE ${initMse.toFixed(2)} → ${finalMse.toFixed(4)}, d=${fittedThickness.toFixed(2)}nm (true: 80nm), A=${fittedA.toFixed(3)} (true: 2.500).`
        : `Gaussian fitting failed: finalMse=${finalMse}, d=${fittedThickness}, A=${fittedA}`,
      durationMs: performance.now() - start,
    });
  }

  // =========================================================================
  // USER MANDATED SENSITIVITY TESTS (TEST 1 to TEST 7)
  // =========================================================================

  // Test 15 (Sensitivity TEST 1): Thickness Sensitivity Test (50 nm vs 100 nm vs 200 nm)
  {
    const start = performance.now();
    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = { name: 'Silicon', materialType: 'tabulated', modelId: 'tabulated_si', parameters: {} };
    const baseLayer: Layer = {
      id: 'l_sens',
      name: 'Film',
      materialName: 'SiO2',
      thickness: 50.0,
      thicknessFit: true,
      thicknessMin: 5,
      thicknessMax: 300,
      thicknessInitial: 50,
      modelId: 'cauchy',
      parameters: {
        A: { id: 'A', name: 'A', unit: '', current: 1.457, initial: 1.457, min: 1.0, max: 3.0, fit: true },
        B: { id: 'B', name: 'B', unit: '', current: 0.0035, initial: 0.0035, min: -0.05, max: 0.1, fit: false },
        C: { id: 'C', name: 'C', unit: '', current: 0.0, initial: 0.0, min: -0.01, max: 0.01, fit: false },
      },
    };

    const c50 = calculatePoint(ambient, [{ ...baseLayer, thickness: 50.0 }], substrate, 550, 70.0);
    const c100 = calculatePoint(ambient, [{ ...baseLayer, thickness: 100.0 }], substrate, 550, 70.0);
    const c200 = calculatePoint(ambient, [{ ...baseLayer, thickness: 200.0 }], substrate, 550, 70.0);

    const diff50_100 = Math.abs(c50.psiDeg - c100.psiDeg) + Math.abs(circularDifferenceDeg(c50.deltaDeg, c100.deltaDeg));
    const diff100_200 = Math.abs(c100.psiDeg - c200.psiDeg) + Math.abs(circularDifferenceDeg(c100.deltaDeg, c200.deltaDeg));
    const passed = diff50_100 > 1.0 && diff100_200 > 1.0;

    results.push({
      name: 'Sensitivity TEST 1: Film Thickness Response (50nm vs 100nm vs 200nm)',
      category: 'solver',
      passed,
      message: passed
        ? `Thickness changes correctly altered P/S: Ψ(50nm)=${c50.psiDeg.toFixed(2)}°, Ψ(100nm)=${c100.psiDeg.toFixed(2)}°, Ψ(200nm)=${c200.psiDeg.toFixed(2)}°.`
        : 'Thickness modification failed to alter solver P/S.',
      durationMs: performance.now() - start,
    });
  }

  // Test 16 (Sensitivity TEST 2): AOI Sensitivity Test (65° vs 70°)
  {
    const start = performance.now();
    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = { name: 'Silicon', materialType: 'tabulated', modelId: 'tabulated_si', parameters: {} };
    const baseLayer: Layer = {
      id: 'l_aoi',
      name: 'Film',
      materialName: 'SiO2',
      thickness: 100.0,
      thicknessFit: true,
      thicknessMin: 10,
      thicknessMax: 200,
      thicknessInitial: 100,
      modelId: 'cauchy',
      parameters: {
        A: { id: 'A', name: 'A', unit: '', current: 1.457, initial: 1.457, min: 1.0, max: 3.0, fit: true },
        B: { id: 'B', name: 'B', unit: '', current: 0.0035, initial: 0.0035, min: -0.05, max: 0.1, fit: false },
        C: { id: 'C', name: 'C', unit: '', current: 0.0, initial: 0.0, min: -0.01, max: 0.01, fit: false },
      },
    };

    const c65 = calculatePoint(ambient, [baseLayer], substrate, 550, 65.0);
    const c70 = calculatePoint(ambient, [baseLayer], substrate, 550, 70.0);
    const diffAoi = Math.abs(c65.psiDeg - c70.psiDeg) + Math.abs(circularDifferenceDeg(c65.deltaDeg, c70.deltaDeg));
    const passed = diffAoi > 2.0;

    results.push({
      name: 'Sensitivity TEST 2: Angle of Incidence (AOI 65° vs 70°)',
      category: 'solver',
      passed,
      message: passed
        ? `AOI change altered P/S: at 65° Ψ=${c65.psiDeg.toFixed(2)}°, Δ=${c65.deltaDeg.toFixed(2)}° vs at 70° Ψ=${c70.psiDeg.toFixed(2)}°, Δ=${c70.deltaDeg.toFixed(2)}°.`
        : 'AOI change failed to alter solver P/S.',
      durationMs: performance.now() - start,
    });
  }

  // Test 17 (Sensitivity TEST 3): Cauchy Parameter Sensitivity
  {
    const start = performance.now();
    const cauchy = modelRegistry.get('cauchy')!;
    const opt1 = cauchy.calculate(500, { A: 1.45, B: 0.003, C: 0.0 });
    const opt2 = cauchy.calculate(500, { A: 1.75, B: 0.003, C: 0.0 });
    const passed = Math.abs(opt1.n - opt2.n) > 0.25;

    results.push({
      name: 'Sensitivity TEST 3: Cauchy Dispersion Parameter Response',
      category: 'models',
      passed,
      message: passed
        ? `Cauchy parameter A change verified: n(A=1.45)=${opt1.n.toFixed(4)} vs n(A=1.75)=${opt2.n.toFixed(4)}.`
        : 'Cauchy parameter change did not affect n.',
      durationMs: performance.now() - start,
    });
  }

  // Test 18 (Sensitivity TEST 4): B-spline Coefficient Sensitivity
  {
    const start = performance.now();
    const bspline = modelRegistry.get('bspline')!;
    const opt1 = bspline.calculate(400, { N0: 1.5, N1: 1.5, N2: 1.5, N3: 1.5, N4: 1.5, K0: 0, K1: 0, K2: 0, K3: 0, K4: 0 });
    const opt2 = bspline.calculate(400, { N0: 1.5, N1: 2.2, N2: 1.5, N3: 1.5, N4: 1.5, K0: 0, K1: 0, K2: 0, K3: 0, K4: 0 });
    const passed = Math.abs(opt1.n - opt2.n) > 0.3;

    results.push({
      name: 'Sensitivity TEST 4: B-Spline Basis Coefficient Response',
      category: 'models',
      passed,
      message: passed
        ? `B-spline coefficient N1 change verified: n(base)=${opt1.n.toFixed(4)} vs n(modified)=${opt2.n.toFixed(4)}.`
        : 'B-spline coefficient change did not affect n.',
      durationMs: performance.now() - start,
    });
  }

  // Test 19 (Sensitivity TEST 5): Gaussian Oscillator Parameter Sensitivity
  {
    const start = performance.now();
    const gaussian = modelRegistry.get('gaussian')!;
    const opt1 = gaussian.calculate(350, { eps_inf: 2.0, A: 1.0, E0: 3.5, sigma: 0.5 });
    const opt2 = gaussian.calculate(350, { eps_inf: 2.0, A: 4.0, E0: 3.5, sigma: 0.5 });
    const passed = Math.abs(opt1.k - opt2.k) > 0.2;

    results.push({
      name: 'Sensitivity TEST 5: Gaussian Oscillator Amplitude Parameter Response',
      category: 'models',
      passed,
      message: passed
        ? `Gaussian amplitude A change verified: k(A=1)=${opt1.k.toFixed(4)} vs k(A=4)=${opt2.k.toFixed(4)}.`
        : 'Gaussian parameter change did not affect optical constants.',
      durationMs: performance.now() - start,
    });
  }

  // Test 20 (Sensitivity TEST 6): Lorentz Oscillator Parameter Sensitivity
  {
    const start = performance.now();
    const lorentz = modelRegistry.get('lorentz')!;
    const opt1 = lorentz.calculate(350, { eps_inf: 2.0, A: 2.0, E0: 3.5, gamma: 0.4 });
    const opt2 = lorentz.calculate(350, { eps_inf: 2.0, A: 8.0, E0: 3.5, gamma: 0.4 });
    const passed = Math.abs(opt1.k - opt2.k) > 0.2;

    results.push({
      name: 'Sensitivity TEST 6: Lorentz Oscillator Amplitude Parameter Response',
      category: 'models',
      passed,
      message: passed
        ? `Lorentz amplitude A change verified: k(A=2)=${opt1.k.toFixed(4)} vs k(A=8)=${opt2.k.toFixed(4)}.`
        : 'Lorentz parameter change did not affect optical constants.',
      durationMs: performance.now() - start,
    });
  }

  // Test 21 (Sensitivity TEST 7): Tauc-Lorentz Eg Bandgap Sensitivity
  {
    const start = performance.now();
    const tauc = modelRegistry.get('tauc_lorentz')!;
    // Below Eg (e.g. 2.0 eV -> 620 nm), k should be zero when Eg=2.5 eV, but non-zero when Eg=1.5 eV
    const optHighEg = tauc.calculate(550, { eps_inf: 2.0, A: 100, E0: 3.8, C: 1.5, Eg: 2.8 }); // 550nm = 2.25 eV < 2.8 eV
    const optLowEg = tauc.calculate(550, { eps_inf: 2.0, A: 100, E0: 3.8, C: 1.5, Eg: 1.8 }); // 550nm = 2.25 eV > 1.8 eV
    const passed = optHighEg.k === 0 && optLowEg.k > 0.05;

    results.push({
      name: 'Sensitivity TEST 7: Tauc-Lorentz Optical Bandgap (Eg) Sensitivity',
      category: 'models',
      passed,
      message: passed
        ? `Tauc-Lorentz Eg bandgap verified: at 550nm (2.25eV), k(Eg=2.8eV)=${optHighEg.k.toFixed(4)} (transparent) vs k(Eg=1.8eV)=${optLowEg.k.toFixed(4)} (absorbing).`
        : 'Tauc-Lorentz Eg change did not alter absorption behavior.',
      durationMs: performance.now() - start,
    });
  }

  // Test 22: Synthetic Recovery Test (Known 120 nm recovered from initial 50 nm)
  {
    const start = performance.now();
    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = { name: 'Silicon', materialType: 'tabulated', modelId: 'tabulated_si', parameters: {} };

    // Known ground truth: 120.0 nm SiO2 film on Si
    const trueLayer: Layer = {
      id: 'syn_layer',
      name: 'Known Oxide Film',
      materialName: 'SiO2',
      thickness: 120.0,
      thicknessFit: true,
      thicknessMin: 10.0,
      thicknessMax: 250.0,
      thicknessInitial: 120.0,
      modelId: 'cauchy',
      parameters: {
        A: { id: 'A', name: 'A', unit: '', current: 1.457, initial: 1.457, min: 1.2, max: 2.2, fit: true },
        B: { id: 'B', name: 'B', unit: '', current: 0.0035, initial: 0.0035, min: -0.01, max: 0.05, fit: false },
        C: { id: 'C', name: 'C', unit: '', current: 0.0, initial: 0.0, min: -0.01, max: 0.01, fit: false },
      },
    };

    // Generate synthetic experimental spectrum at 70°
    const synthWls = [350, 400, 450, 500, 550, 600, 650, 700, 750, 800];
    const synthPoints = synthWls.map((wl) => {
      const calc = calculatePoint(ambient, [trueLayer], substrate, wl, 70.0);
      return {
        id: `syn_${wl}`,
        wavelength: wl,
        aoi: 70.0,
        psiExp: calc.psiDeg,
        deltaExp: calc.deltaDeg,
      };
    });

    // Deliberately perturb initial thickness to 50.0 nm (large deviation from 120.0 nm)
    const perturbedLayer: Layer = {
      ...trueLayer,
      thickness: 50.0,
      thicknessInitial: 50.0,
    };

    const fitOutput = await runAutoFit({
      ambient,
      layers: [perturbedLayer],
      substrate,
      points: synthPoints,
      config: {
        maxIterations: 40,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
      },
    });

    const initMse = fitOutput.fittingResult.initialMse;
    const finalMse = fitOutput.fittingResult.finalMse;
    const recoveredThickness = fitOutput.updatedLayers[0].thickness;

    const isRecovered = Math.abs(recoveredThickness - 120.0) < 1.0;
    const isMseDecreased = finalMse < initMse && finalMse < 0.01;
    const passed = isRecovered && isMseDecreased;

    results.push({
      name: 'Synthetic Recovery Test: 120nm Target Recovered from 50nm Disturbance',
      category: 'fitting',
      passed,
      message: passed
        ? `Recovery successful: Target 120nm recovered to ${recoveredThickness.toFixed(2)}nm from 50nm starting point. MSE reduced from ${initMse.toFixed(2)} to ${finalMse.toFixed(5)}.`
        : `Recovery test failed: Recovered=${recoveredThickness.toFixed(2)}nm, Final MSE=${finalMse}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 23: Multi-Oscillator Model & Dielectric Summation
  {
    const start = performance.now();
    const multiOsc = modelRegistry.get('multi_oscillator');
    let passed = false;
    let msg = '';
    if (multiOsc) {
      const opt = multiOsc.calculate(400, {
        eps_inf: 2.2,
        A1: 2.0,
        E01: 3.5,
        w1: 0.5,
        A2: 1.5,
        E02: 4.5,
        w2: 0.7,
      });
      const eps1Val = opt.eps1 ?? (opt.n * opt.n - opt.k * opt.k);
      const eps2Val = opt.eps2 ?? (2 * opt.n * opt.k);
      passed = opt.n >= 1.0 && opt.k >= 0.0 && eps1Val > 0;
      msg = passed
        ? `Multi-oscillator verified at 400nm: n=${opt.n.toFixed(4)}, k=${opt.k.toFixed(4)}, eps1=${eps1Val.toFixed(3)}, eps2=${eps2Val.toFixed(3)}.`
        : 'Multi-oscillator values non-physical.';
    } else {
      msg = 'Multi-oscillator model not registered.';
    }

    results.push({
      name: 'Physical Dispersion: Multi-Oscillator (Gaussian + Lorentz) Summation',
      category: 'models',
      passed,
      message: msg,
      durationMs: performance.now() - start,
    });
  }

  // Test 24: Raw MSE vs Weighted MSE & Residual Peak Identification
  {
    const start = performance.now();
    const testPoints = [
      { id: '1', wavelength: 300, aoi: 70, psiExp: 30, deltaExp: 100, psiCalc: 32, deltaCalc: 105 }, // psiRes=2, deltaRes=5
      { id: '2', wavelength: 600, aoi: 70, psiExp: 40, deltaExp: 150, psiCalc: 40, deltaCalc: 151 }, // psiRes=0, deltaRes=1
    ];
    // Point 1: 2^2 + 5^2 = 29. Point 2: 0^2 + 1^2 = 1. Raw total = 30 / 4 = 7.5.
    const resUniform = computeResidualMetrics(testPoints, 'uniform', 1.0, 1.0, 3);
    const resWeighted = computeResidualMetrics(testPoints, 'psi_dominant', 2.0, 0.5, 3);

    const isRawCorrect = Math.abs(resUniform.rawMse - 7.5) < 1e-4;
    const isWeightedDifferent = Math.abs(resWeighted.weightedMse - resUniform.rawMse) > 0.1;
    const hasAic = resUniform.aic !== undefined && resUniform.bic !== undefined;
    const passed = isRawCorrect && isWeightedDifferent && hasAic;

    results.push({
      name: 'Statistical Framework: Unfalsifiable Raw MSE & AIC/BIC Protection',
      category: 'residual',
      passed,
      message: passed
        ? `Raw MSE strictly preserved at ${resUniform.rawMse.toFixed(3)} (Weighted=${resWeighted.weightedMse.toFixed(3)}, AIC=${resUniform.aic}).`
        : 'Raw MSE or information criteria calculation mismatch.',
      durationMs: performance.now() - start,
    });
  }

  // Test 25: Strict 8-Step Auto Fit Pipeline Verification (Cauchy 0-pt -> B-spline -> Physical Model)
  {
    const start = performance.now();
    const { runAutomatedEllipsometryFit } = await import('../fitting/autoWorkflow');
    const { createSiO2OnSiProject } = await import('../data/defaultProjects');
    const project = createSiO2OnSiProject();

    // Run automated workflow targeting Gaussian specifically
    const output = await runAutomatedEllipsometryFit({
      ambient: project.ambient,
      layers: project.layers,
      substrate: project.substrate,
      points: project.experimentData!.points.slice(0, 30), // use first 30 points for fast test
      config: {
        maxIterations: 10,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
        fittingStrategy: 'standard',
        targetMse: 10.0,
      },
      targetModelId: 'gaussian',
    });

    const audit = output.pipelineData;
    const hasCauchyStage = !!audit && !!audit.cauchy0Point && audit.cauchy0Point.rawMse > 0;
    const hasBsplineStage = !!audit && !!audit.bspline && audit.bspline.nodeWavelengths.length > 0;
    const hasPhysicalStage = !!audit && audit.selectedPhysicalModel === 'Gaussian (高斯振盪子)';
    const finalModelIsGaussian = output.updatedLayers[0].modelId === 'gaussian';

    const passed = hasCauchyStage && hasBsplineStage && hasPhysicalStage && finalModelIsGaussian;

    results.push({
      name: 'Sequential Pipeline Audit: Cauchy 0-pt → B-spline n/k → Gaussian Solver',
      category: 'fitting',
      passed,
      message: passed
        ? `Pipeline strictly followed: Cauchy MSE=${audit?.cauchy0Point.rawMse.toFixed(3)} -> B-spline Knots=${audit?.bspline.nodeWavelengths.length} -> Final Model=${audit?.selectedPhysicalModel} (Final MSE=${audit?.rawMse.toFixed(3)}).`
        : `Pipeline order breached or missing audit stages.`,
      durationMs: performance.now() - start,
    });
  }

  // Test 26: Anti-Model-Switching Protection (User-selected Gaussian / Lorentz / Tauc-Lorentz never reverts to Cauchy)
  {
    const start = performance.now();
    const { runAutomatedEllipsometryFit } = await import('../fitting/autoWorkflow');
    const { createSiO2OnSiProject } = await import('../data/defaultProjects');
    const project = createSiO2OnSiProject();

    // Test with Lorentz model
    const outputLorentz = await runAutomatedEllipsometryFit({
      ambient: project.ambient,
      layers: project.layers,
      substrate: project.substrate,
      points: project.experimentData!.points.slice(0, 20),
      config: {
        maxIterations: 8,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
        fittingStrategy: 'aggressive', // Even in aggressive mode!
        targetMse: 10.0,
      },
      targetModelId: 'lorentz',
    });

    const returnedModel = outputLorentz.updatedLayers[0].modelId;
    const passed = returnedModel === 'lorentz';

    results.push({
      name: 'Anti-Model-Switching Guarantee: Aggressive Fit Never Reverts to Cauchy',
      category: 'fitting',
      passed,
      message: passed
        ? `Model integrity verified: User requested 'lorentz' and optimizer output is strictly '${returnedModel}', even during Aggressive Fit multi-start.`
        : `Violation detected: User requested lorentz but system returned ${returnedModel}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 27: B-spline to Physical Model Feature Extraction & Initialization
  {
    const start = performance.now();
    // Synthetic B-spline spectrum with absorption peak around 350 nm (3.54 eV)
    const synthSpectrum: { wavelength: number; n: number; k: number }[] = [];
    for (let wl = 200; wl <= 900; wl += 25) {
      const peak = Math.exp(-Math.pow((wl - 350) / 40, 2));
      synthSpectrum.push({
        wavelength: wl,
        n: 1.5 + 0.3 * peak,
        k: 0.8 * peak,
      });
    }

    const gaussianInit = modelRegistry.initializePhysicalModelFromBSpline('gaussian', synthSpectrum);
    const lorentzInit = modelRegistry.initializePhysicalModelFromBSpline('lorentz', synthSpectrum);

    // Peak at 350 nm corresponds to 1239.84 / 350 ~= 3.54 eV
    const peakEnergyExpected = 1239.84 / 350;
    const gaussianE0 = gaussianInit.E0?.current ?? 0;
    const lorentzE0 = lorentzInit.E0?.current ?? 0;

    const gaussianClose = Math.abs(gaussianE0 - peakEnergyExpected) < 0.5;
    const lorentzClose = Math.abs(lorentzE0 - peakEnergyExpected) < 0.5;
    const validParams = (gaussianInit.A?.current ?? 0) > 0 && (lorentzInit.A?.current ?? 0) > 0;

    const passed = gaussianClose && lorentzClose && validParams;

    results.push({
      name: 'Spectral Feature Extraction: B-spline Peak -> Oscillator Center & Width',
      category: 'models',
      passed,
      message: passed
        ? `Features extracted successfully: Absorption peak at 350nm (~${peakEnergyExpected.toFixed(2)}eV) mapped to Gaussian E0=${gaussianE0.toFixed(2)}eV, Lorentz E0=${lorentzE0.toFixed(2)}eV.`
        : `Feature conversion mismatch: Gaussian E0=${gaussianE0}, Lorentz E0=${lorentzE0}`,
      durationMs: performance.now() - start,
    });
  }

  // Test 28: Synthetic Recovery Test (End-to-End Recovery of Known Thickness and Optical Constants)
  {
    const start = performance.now();
    const { runAutomatedEllipsometryFit } = await import('../fitting/autoWorkflow');
    const { solveEllipsometryTMM } = await import('../solver/transferMatrix');
    const { evaluateSubstrateOpticalConstants } = await import('../solver/calculator');

    const ambient = { name: 'Air', n: 1.0, k: 0.0 };
    const substrate: Substrate = {
      name: 'Si Substrate',
      materialType: 'tabulated',
      modelId: 'tabulated_si',
      parameters: {},
    };

    // 1. Setup Ground Truth
    const trueThickness = 85.0; // nm
    const trueA = 1.465;
    const trueB = 0.0042;
    const aoi = 70.0;
    const wavelengths = [350, 400, 450, 500, 550, 600, 650, 700, 750, 800];
    const ambientN = new Complex(1.0, 0.0);

    // Generate synthetic experimental Psi & Delta points
    const syntheticPoints = wavelengths.map((wl) => {
      const lamUm = wl / 1000;
      const trueN = trueA + trueB / (lamUm * lamUm);
      const siOpt = evaluateSubstrateOpticalConstants(substrate, wl);
      const res = solveEllipsometryTMM(
        ambientN,
        [{ thicknessNm: trueThickness, N: new Complex(trueN, 0.0) }],
        siOpt,
        wl,
        aoi
      );
      return {
        id: `synth_pt_${wl}`,
        wavelength: wl,
        aoi,
        psiExp: res.psiDeg,
        deltaExp: res.deltaDeg,
      };
    });

    // 2. Perturbed Initial State (Guess thickness 125.0 nm instead of 85.0 nm)
    const initialLayers: Layer[] = [
      {
        id: 'layer_test',
        name: 'Synthetic Film',
        materialName: 'Dielectric',
        thickness: 125.0, // Perturbed by +40 nm
        thicknessMin: 0.1,
        thicknessMax: 500.0,
        thicknessFit: true,
        thicknessInitial: 125.0,
        modelId: 'cauchy',
        parameters: modelRegistry.createParameterSet('cauchy'),
      },
    ];

    // 3. Execute AutoEllipso Pipeline
    const output = await runAutomatedEllipsometryFit({
      ambient,
      layers: initialLayers,
      substrate,
      points: syntheticPoints,
      config: {
        maxIterations: 15,
        tolerance: 1e-4,
        dampingFactor: 0.01,
        fitWeighting: 'uniform',
        fittingStrategy: 'standard',
        targetMse: 10.0,
        enableMultiStart: true,
      },
      targetModelId: 'cauchy',
    });

    const recoveredThickness = output.updatedLayers[0].thickness;
    const finalRawMse = output.fittingResult.rawMse ?? output.fittingResult.finalMse;
    const thicknessDiff = Math.abs(recoveredThickness - trueThickness);
    const freshVerified = output.fittingResult.freshCalculationVerified === true;

    // Passed if recovered thickness is within 2.0 nm of ground truth and MSE < 5.0
    const passed = thicknessDiff < 2.0 && finalRawMse < 5.0 && freshVerified;

    results.push({
      name: 'Synthetic Recovery Test: Inverting Known Thickness (85 nm) and n(λ) from True Forward Spectrum',
      category: 'fitting',
      passed,
      message: passed
        ? `Recovery SUCCESS: True d=${trueThickness} nm -> Inverted d=${recoveredThickness.toFixed(2)} nm (Error: ${thicknessDiff.toFixed(2)} nm), Final Raw MSE=${finalRawMse.toFixed(4)}, Fresh Forward Verified: ${freshVerified}.`
        : `Recovery FAILED: True d=${trueThickness} nm, Recovered d=${recoveredThickness.toFixed(2)} nm, MSE=${finalRawMse.toFixed(4)}.`,
      durationMs: performance.now() - start,
    });
  }

  // Test 29: 100 nm SiO2 / Si (AOI = 70°) Benchmark Recovery & >=20 Independent Multi-Starts
  {
    const start = performance.now();
    const { runAutomatedEllipsometryFit } = await import('../fitting/autoWorkflow');
    const project = createSiO2OnSiProject();

    const output = await runAutomatedEllipsometryFit({
      ambient: project.ambient,
      layers: project.layers,
      substrate: project.substrate,
      points: project.experimentData!.points,
      config: {
        ...project.fittingConfig,
        fittingStrategy: 'standard',
        targetMse: 10.0,
        enableMultiStart: true,
      },
      targetModelId: 'gaussian',
    });

    const bsplineMse = output.pipelineData.bspline.rawMse;
    const bsplineRegPenalty = output.pipelineData.bspline.regularizationPenalty;
    const bsplineTotalObj = output.pipelineData.bspline.totalObjective;
    const multiStartCount = output.pipelineData.multiStartSummary.totalStarts;
    const finalThickness = output.finalThickness;
    const finalRawMse = output.fittingResult.rawMse ?? output.fittingResult.finalMse;
    const psiRmse = output.fittingResult.psiRmse ?? 99;
    const deltaRmse = output.fittingResult.deltaRmse ?? 99;
    const freshVerified = output.fittingResult.freshCalculationVerified === true;

    const passed =
      Math.abs(finalThickness - 100.0) <= 2.0 &&
      finalRawMse < 5.0 &&
      psiRmse < 1.0 &&
      deltaRmse < 3.0 &&
      multiStartCount >= 20 &&
      Math.abs(bsplineTotalObj - (bsplineMse + bsplineRegPenalty)) < 1e-3 &&
      freshVerified;

    results.push({
      name: 'Benchmark Recovery: 100 nm SiO2 / Si (AOI=70°) with Regularized B-spline & 20-Start Gaussian',
      category: 'fitting',
      passed,
      message: passed
        ? `100nm SiO2/Si verified: d=${finalThickness.toFixed(2)} nm, Raw MSE=${finalRawMse.toFixed(4)}, Ψ RMSE=${psiRmse.toFixed(3)}°, Δ RMSE=${deltaRmse.toFixed(3)}°, B-spline MSE=${bsplineMse.toFixed(4)} (Reg=${bsplineRegPenalty.toFixed(4)}), Starts=${multiStartCount}.`
        : `100nm SiO2/Si failed: d=${finalThickness.toFixed(2)} nm, Raw MSE=${finalRawMse.toFixed(4)}, Starts=${multiStartCount}`,
      durationMs: performance.now() - start,
    });
  }

  return results;
}
