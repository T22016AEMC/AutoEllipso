/**
 * Pre-configured Realistic Ellipsometry Projects
 * Generated using verified physical optical constants for immediate workflow exploration.
 */
import { EllipsometryProject, Layer } from '../types/ellipsometry';
import { modelRegistry } from '../modelRegistry/registry';
import { calculateSpectrum } from '../solver/calculator';
import { normalizeDeltaDeg } from '../solver/ellipsometricAngles';

/**
 * Generate synthetic realistic experimental data from a ground-truth optical stack
 */
function generateBenchmarkData(
  ambient: { name: string; n: number; k: number },
  trueLayers: Layer[],
  substrate: { name: string; materialType: 'tabulated'; modelId: string; parameters: any },
  wavelengths: number[],
  angles: number[],
  noisePsiDeg: number = 0.03,
  noiseDeltaDeg: number = 0.03
) {
  const points = [];
  let idCounter = 1;

  for (const aoi of angles) {
    for (const wl of wavelengths) {
      points.push({
        id: `pt_${idCounter++}`,
        wavelength: wl,
        aoi,
        psiExp: 0,
        deltaExp: 0,
      });
    }
  }

  // Calculate ground-truth values
  const groundTruth = calculateSpectrum(ambient, trueLayers, substrate, points);

  // Add realistic measurement noise
  return groundTruth.map((pt) => {
    // Pseudo-random deterministic noise based on wavelength and angle
    const pseudoRand1 = Math.sin(pt.wavelength * 12.9898 + pt.aoi * 78.233) * 43758.5453;
    const pseudoRand2 = Math.cos(pt.wavelength * 43.123 + pt.aoi * 19.456) * 23421.678;
    const u1 = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, pseudoRand1 - Math.floor(pseudoRand1)));
    const u2 = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, pseudoRand2 - Math.floor(pseudoRand2)));
    const radius = Math.sqrt(-2 * Math.log(u1));
    const noise1 = radius * Math.cos(2 * Math.PI * u2) * noisePsiDeg;
    const noise2 = radius * Math.sin(2 * Math.PI * u2) * noiseDeltaDeg;

    const psiNoisy = Math.max(0, Math.min(90, (pt.psiCalc ?? 30) + noise1));
    const deltaNoisy = normalizeDeltaDeg((pt.deltaCalc ?? 120) + noise2);

    return {
      id: pt.id,
      wavelength: pt.wavelength,
      aoi: pt.aoi,
      psiExp: psiNoisy,
      deltaExp: deltaNoisy,
      psiSigma: noisePsiDeg,
      deltaSigma: noiseDeltaDeg,
      psiCalc: pt.psiCalc,
      deltaCalc: pt.deltaCalc,
      psiResidual: pt.psiCalc! - psiNoisy,
      deltaResidual: pt.deltaCalc! - deltaNoisy,
    };
  });
}

/**
 * Standard Project: 100 nm SiO2 on Si Substrate (Single Angle 70° AOI)
 * Wavelength range: 190 nm ~ 900 nm
 */
export function createSiO2OnSiProject(): EllipsometryProject {
  const ambient = { name: '空氣 (Air)', n: 1.0, k: 0.0 };

  const substrate = {
    name: '矽晶圓基底 (c-Si)',
    materialType: 'tabulated' as const,
    modelId: 'tabulated_si',
    parameters: modelRegistry.createParameterSet('tabulated_si'),
  };

  // Ground truth layer for generating experimental points: 100.0 nm SiO2 Cauchy
  const trueLayer: Layer = {
    id: 'layer_sio2',
    name: 'SiO2 熱氧化層',
    materialName: 'SiO2',
    thickness: 100.0,
    thicknessFit: true,
    thicknessMin: 40.0,
    thicknessMax: 200.0,
    thicknessInitial: 100.0,
    modelId: 'cauchy',
    parameters: modelRegistry.createParameterSet('cauchy'),
  };

  // Generate wavelengths from 190nm to 900nm in steps of 10nm
  const wavelengths: number[] = [];
  for (let w = 190; w <= 900; w += 10) {
    wavelengths.push(w);
  }

  const expPoints = generateBenchmarkData(ambient, [trueLayer], substrate, wavelengths, [70.0], 0.04, 0.04);

  // Now create the user's initial model state with a deliberate perturbation
  // Initial thickness = 90.0 nm (off by 10 nm) to allow immediate Manual & Auto Fit demonstration
  const initialLayer: Layer = {
    ...trueLayer,
    thickness: 90.0, // Perturbed initial value
    thicknessInitial: 90.0,
    parameters: {
      ...trueLayer.parameters,
      A: {
        ...trueLayer.parameters['A'],
        current: 1.450, // Perturbed from 1.457
        initial: 1.450,
        fit: true,
      },
      B: {
        ...trueLayer.parameters['B'],
        current: 0.0035,
        initial: 0.0035,
        fit: false,
      },
      C: {
        ...trueLayer.parameters['C'],
        current: 0.0001,
        initial: 0.0001,
        fit: false,
      },
    },
  };

  // Compute calculated values for initial perturbed state
  const calculatedPoints = calculateSpectrum(ambient, [initialLayer], substrate, expPoints);

  return {
    id: 'proj_sio2_si_100nm',
    deltaConventionVersion: 2,
    name: '100 nm SiO2 / Si 晶圓 (70° 入射角)',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: '標準光譜橢圓偏光分析校正樣品：矽晶圓上 100 nm 熱氧化層 SiO2，擬合波長涵蓋 190 nm ~ 900 nm (深紫外至近紅外)，入射角 70°。',
    ambient,
    layers: [initialLayer],
    substrate,
    experimentData: {
      filename: 'sio2_on_si_70deg_190_900nm.csv',
      deltaConvention: 'standard',
      importedAt: new Date().toISOString(),
      points: calculatedPoints,
      angles: [70.0],
      wavelengthMin: 190,
      wavelengthMax: 900,
    },
    fittingConfig: {
      maxIterations: 50,
      tolerance: 1e-5,
      dampingFactor: 0.01,
      fitWeighting: 'standard_deviation',
      fitWavelengthMin: 190,
      fitWavelengthMax: 900,
    },
    fittingResult: null,
    visualizationSettings: {
      showExperimental: true,
      showCalculated: true,
      showResiduals: true,
      selectedAoi: 70.0,
      activeTab: 'both',
    },
  };
}

/**
 * Multi-AOI Benchmark Project: 100 nm SiO2 on Si Substrate with 3 Angles (65°, 70°, 75°)
 * Ideal for testing Multi-Angle Global Fitting and shared physical parameter convergence.
 */
export function createMultiAoiSiO2OnSiProject(): EllipsometryProject {
  const ambient = { name: '空氣 (Air)', n: 1.0, k: 0.0 };

  const substrate = {
    name: '矽晶圓基底 (c-Si)',
    materialType: 'tabulated' as const,
    modelId: 'tabulated_si',
    parameters: modelRegistry.createParameterSet('tabulated_si'),
  };

  const trueLayer: Layer = {
    id: 'layer_sio2_multi',
    name: 'SiO2 熱氧化層',
    materialName: 'SiO2',
    thickness: 100.0,
    thicknessFit: true,
    thicknessMin: 40.0,
    thicknessMax: 200.0,
    thicknessInitial: 100.0,
    modelId: 'cauchy',
    parameters: modelRegistry.createParameterSet('cauchy'),
  };

  const wavelengths: number[] = [];
  for (let w = 190; w <= 900; w += 10) {
    wavelengths.push(w);
  }

  const expPoints = generateBenchmarkData(
    ambient,
    [trueLayer],
    substrate,
    wavelengths,
    [65.0, 70.0, 75.0],
    0.04,
    0.04
  );

  const initialLayer: Layer = {
    ...trueLayer,
    thickness: 88.0, // Perturbed by 12 nm
    thicknessInitial: 88.0,
    parameters: {
      ...trueLayer.parameters,
      A: {
        ...trueLayer.parameters['A'],
        current: 1.450,
        initial: 1.450,
        fit: true,
      },
    },
  };

  const calculatedPoints = calculateSpectrum(ambient, [initialLayer], substrate, expPoints);

  return {
    id: 'proj_sio2_multi_aoi',
    deltaConventionVersion: 2,
    name: '100 nm SiO2 / Si 晶圓 (多角度 65°/70°/75° 全域擬合)',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: '標準多入射角光譜橢圓偏光分析樣品：矽晶圓上 100 nm 熱氧化層 SiO2，同時在 65°、70°、75° 三個入射角下進行全域 Global Fitting。',
    ambient,
    layers: [initialLayer],
    substrate,
    experimentData: {
      filename: 'sio2_on_si_multi_aoi_65_70_75deg.csv',
      deltaConvention: 'standard',
      importedAt: new Date().toISOString(),
      points: calculatedPoints,
      angles: [65.0, 70.0, 75.0],
      wavelengthMin: 190,
      wavelengthMax: 900,
    },
    fittingConfig: {
      maxIterations: 50,
      tolerance: 1e-5,
      dampingFactor: 0.01,
      fitWeighting: 'standard_deviation',
      fitWavelengthMin: 190,
      fitWavelengthMax: 900,
      activeFitAois: [65.0, 70.0, 75.0],
    },
    fittingResult: null,
    visualizationSettings: {
      showExperimental: true,
      showCalculated: true,
      showResiduals: true,
      selectedAoi: 'all',
      activeTab: 'both',
    },
  };
}

/**
 * High-k dielectric: 35 nm TiO2 on Si (Dual Angle 65° & 75° AOI) with Tauc-Lorentz model
 * Wavelength range: 190 nm ~ 900 nm
 */
export function createTiO2OnSiProject(): EllipsometryProject {
  const ambient = { name: '空氣 (Air)', n: 1.0, k: 0.0 };

  const substrate = {
    name: '矽晶圓基底 (c-Si)',
    materialType: 'tabulated' as const,
    modelId: 'tabulated_si',
    parameters: modelRegistry.createParameterSet('tabulated_si'),
  };

  const trueLayer: Layer = {
    id: 'layer_tio2',
    name: 'TiO2 高介電薄膜',
    materialName: 'TiO2',
    thickness: 35.0,
    thicknessFit: true,
    thicknessMin: 15.0,
    thicknessMax: 80.0,
    thicknessInitial: 35.0,
    modelId: 'tauc_lorentz',
    parameters: modelRegistry.createParameterSet('tauc_lorentz'),
  };

  const wavelengths: number[] = [];
  for (let w = 190; w <= 900; w += 10) {
    wavelengths.push(w);
  }

  const expPoints = generateBenchmarkData(ambient, [trueLayer], substrate, wavelengths, [65.0, 75.0], 0.05, 0.05);

  const initialLayer: Layer = {
    ...trueLayer,
    thickness: 42.0, // Perturbed from 35.0 nm
    thicknessInitial: 42.0,
  };

  const calculatedPoints = calculateSpectrum(ambient, [initialLayer], substrate, expPoints);

  return {
    id: 'proj_tio2_si',
    deltaConventionVersion: 2,
    name: '35 nm TiO2 / Si 晶圓 (Tauc-Lorentz, 雙角度 65°/75°)',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: '高折射率與高介電常數 TiO2 薄膜，利用 Tauc-Lorentz 色散關係擬合 190 nm ~ 900 nm 能隙與紫外躍遷。',
    ambient,
    layers: [initialLayer],
    substrate,
    experimentData: {
      filename: 'tio2_on_si_dual_angle_190_900nm.csv',
      deltaConvention: 'standard',
      importedAt: new Date().toISOString(),
      points: calculatedPoints,
      angles: [65.0, 75.0],
      wavelengthMin: 190,
      wavelengthMax: 900,
    },
    fittingConfig: {
      maxIterations: 60,
      tolerance: 1e-5,
      dampingFactor: 0.01,
      fitWeighting: 'standard_deviation',
      fitWavelengthMin: 190,
      fitWavelengthMax: 900,
    },
    fittingResult: null,
    visualizationSettings: {
      showExperimental: true,
      showCalculated: true,
      showResiduals: true,
      selectedAoi: 'all',
      activeTab: 'both',
    },
  };
}

/**
 * Blank clean project ready for custom CSV import
 */
export function createBlankProject(): EllipsometryProject {
  const ambient = { name: '空氣 (Air)', n: 1.0, k: 0.0 };
  const substrate = {
    name: '矽晶圓基底 (c-Si)',
    materialType: 'tabulated' as const,
    modelId: 'tabulated_si',
    parameters: modelRegistry.createParameterSet('tabulated_si'),
  };

  const defaultLayer: Layer = {
    id: `layer_${Date.now()}`,
    name: '薄膜層 1',
    materialName: '介電層 (Dielectric)',
    thickness: 100.0,
    thicknessFit: true,
    thicknessMin: 1.0,
    thicknessMax: 500.0,
    thicknessInitial: 100.0,
    modelId: 'cauchy',
    parameters: modelRegistry.createParameterSet('cauchy'),
  };

  return {
    id: `proj_${Date.now()}`,
    deltaConventionVersion: 2,
    name: '新增橢偏擬合專案',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: '全新空白工作區，可匯入 190 nm ~ 900 nm 實驗 CSV 光譜數據並進行樣品膜層結構光學擬合。',
    ambient,
    layers: [defaultLayer],
    substrate,
    experimentData: null,
    fittingConfig: {
      maxIterations: 50,
      tolerance: 1e-5,
      dampingFactor: 0.01,
      fitWeighting: 'standard_deviation',
      fitWavelengthMin: 190,
      fitWavelengthMax: 900,
    },
    fittingResult: null,
    visualizationSettings: {
      showExperimental: true,
      showCalculated: true,
      showResiduals: true,
      selectedAoi: 70.0,
      activeTab: 'both',
    },
  };
}
