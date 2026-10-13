/**
 * Material Registry / Material Database
 * Decoupled repository for physical material entries.
 *
 * NOTE: Material Database != Optical Model Database.
 * Optical models define the mathematical dispersion equations (Cauchy, Lorentz, Gaussian, etc.).
 * Material entries represent physical materials, which specify recommended optical models,
 * verified physical parameter baselines, and scientific citations.
 */
import { MaterialDefinition } from '../types/ellipsometry';

export const STANDARD_MATERIALS: MaterialDefinition[] = [
  {
    id: 'mat_sio2',
    name: 'Silicon Dioxide (SiO₂)',
    category: 'dielectric',
    description: 'High-purity thermally grown or PECVD silicon dioxide, highly transparent across visible and NIR.',
    defaultModelId: 'cauchy',
    defaultParameters: {
      A: 1.457,
      B: 0.0035,
      C: 0.0001,
      k0: 0.0,
    },
    reference: 'Malitson, I. H. (1965). Interspecimen comparison of the refractive index of fused silica. JOSA, 55(10), 1205-1209.',
    validRange: { minWavelengthNm: 250, maxWavelengthNm: 2000 },
  },
  {
    id: 'mat_tio2',
    name: 'Titanium Dioxide (TiO₂)',
    category: 'dielectric',
    description: 'High refractive index optical coating with UV interband absorption onset at ~3.1 eV.',
    defaultModelId: 'tauc_lorentz',
    defaultParameters: {
      eps_inf: 1.8,
      A: 120.0,
      E0: 3.65,
      C: 1.5,
      Eg: 3.1,
    },
    reference: 'Jellison, G. E., & Sales, B. C. (1996). Optical functions of amorphous semiconductors. Appl. Phys. Lett., 69(3), 371.',
    validRange: { minWavelengthNm: 280, maxWavelengthNm: 1800 },
  },
  {
    id: 'mat_al2o3',
    name: 'Aluminum Oxide (Al₂O₃)',
    category: 'dielectric',
    description: 'Sapphire / alumina dielectric barrier thin film with high bandgap (~8.8 eV) and low visible dispersion.',
    defaultModelId: 'cauchy',
    defaultParameters: {
      A: 1.765,
      B: 0.0048,
      C: 0.0,
      k0: 0.0,
    },
    reference: 'Boidin, R. et al. (2016). Pulsed laser deposited Al2O3 thin films: Optical properties. Appl. Opt., 55(31), 8846.',
    validRange: { minWavelengthNm: 200, maxWavelengthNm: 2500 },
  },
  {
    id: 'mat_si3n4',
    name: 'Silicon Nitride (Si₃N₄)',
    category: 'dielectric',
    description: 'LPCVD/PECVD silicon nitride used for anti-reflection coatings, waveguiding, and passivation.',
    defaultModelId: 'cauchy',
    defaultParameters: {
      A: 1.980,
      B: 0.0090,
      C: 0.0,
      k0: 0.0,
    },
    reference: 'Philipp, H. R. (1973). Optical properties of silicon nitride. J. Electrochem. Soc., 120(2), 295.',
    validRange: { minWavelengthNm: 300, maxWavelengthNm: 2000 },
  },
  {
    id: 'mat_polymer_pmma',
    name: 'Polymer / Organic Resist (PMMA)',
    category: 'polymer',
    description: 'Organic polymer thin film with inhomogeneous UV absorption characterized by Gaussian broadening.',
    defaultModelId: 'gaussian',
    defaultParameters: {
      eps_inf: 2.15,
      A: 2.8,
      E0: 4.8,
      sigma: 0.65,
    },
    reference: 'Woollam, J. A. et al. (1999). Spectroscopic Ellipsometry of Organic and Polymeric Layers. Proc. SPIE.',
    validRange: { minWavelengthNm: 220, maxWavelengthNm: 1700 },
  },
  {
    id: 'mat_ito',
    name: 'Indium Tin Oxide (ITO)',
    category: 'conductor',
    description: 'Transparent conducting oxide with Drude free carrier plasmon absorption in NIR.',
    defaultModelId: 'drude',
    defaultParameters: {
      eps_inf: 3.8,
      wp: 2.05,
      gamma: 0.18,
    },
    reference: 'Ederth, J. et al. (2003). Electrical and optical properties of thin films of indium tin oxide. Phys. Rev. B, 68(15), 155410.',
    validRange: { minWavelengthNm: 350, maxWavelengthNm: 2500 },
  },
  {
    id: 'mat_csi',
    name: 'Crystalline Silicon (c-Si)',
    category: 'semiconductor',
    description: 'Single-crystal silicon wafer substrate with prominent E1 and E2 critical point band transitions.',
    defaultModelId: 'tabulated_si',
    defaultParameters: {},
    reference: 'Aspnes, D. E., & Studna, A. A. (1983). Dielectric functions of Si. Phys. Rev. B, 27(2), 985.',
    validRange: { minWavelengthNm: 250, maxWavelengthNm: 1200 },
  },
  {
    id: 'mat_bk7',
    name: 'Crown Glass (Schott BK7)',
    category: 'glass',
    description: 'Standard optical borosilicate crown glass substrate.',
    defaultModelId: 'sellmeier',
    defaultParameters: {
      B1: 1.0396,
      C1: 0.0060,
      B2: 0.2318,
      C2: 0.0200,
    },
    reference: 'Schott Glass Optical Data Sheets (N-BK7 Standard).',
    validRange: { minWavelengthNm: 300, maxWavelengthNm: 2500 },
  },
  {
    id: 'mat_gaas',
    name: 'Gallium Arsenide (GaAs)',
    category: 'semiconductor',
    description: 'Direct bandgap III-V semiconductor with strong excitonic resonance modeled via Lorentz oscillator.',
    defaultModelId: 'lorentz',
    defaultParameters: {
      eps_inf: 10.9,
      A: 38.0,
      E0: 2.95,
      gamma: 0.35,
    },
    reference: 'Adachi, S. (1989). Optical dispersion relations for GaP, GaAs, GaSb, InP, InAs, InSb. J. Appl. Phys., 66(12), 6030.',
    validRange: { minWavelengthNm: 300, maxWavelengthNm: 1600 },
  },
  {
    id: 'mat_polysi',
    name: 'Polycrystalline Silicon (Poly-Si)',
    category: 'semiconductor',
    description: 'Amorphous-to-polycrystalline silicon thin film with broadened band transitions.',
    defaultModelId: 'tauc_lorentz',
    defaultParameters: {
      eps_inf: 2.0,
      A: 160.0,
      E0: 3.4,
      C: 2.2,
      Eg: 1.5,
    },
    reference: 'Jellison, G. E. (1996). Spectroscopic ellipsometry of amorphous and polycrystalline semiconductors.',
    validRange: { minWavelengthNm: 250, maxWavelengthNm: 1500 },
  },
];

class MaterialRegistry {
  private materials: Map<string, MaterialDefinition> = new Map();

  constructor() {
    for (const mat of STANDARD_MATERIALS) {
      this.register(mat);
    }
  }

  register(mat: MaterialDefinition): void {
    this.materials.set(mat.id, mat);
  }

  get(id: string): MaterialDefinition | undefined {
    return this.materials.get(id);
  }

  getAll(): MaterialDefinition[] {
    return Array.from(this.materials.values());
  }

  getByCategory(cat: MaterialDefinition['category']): MaterialDefinition[] {
    return this.getAll().filter((m) => m.category === cat);
  }
}

export const materialRegistry = new MaterialRegistry();
