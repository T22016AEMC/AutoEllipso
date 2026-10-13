/**
 * Bounded Nonlinear Least Squares Optimizer using Levenberg-Marquardt
 *
 * Designed specifically for physical models where parameter bounds [min, max]
 * and disparate physical scales (e.g. thickness in nm vs Cauchy B in μm²) must be strictly respected.
 */
import { circularDifferenceDeg } from './residual';

export interface OptimizationVariable {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
}

export interface OptimizerOptions {
  maxIterations?: number;
  tolerance?: number;
  initialLambda?: number;
  isAngularResidual?: (index: number) => boolean;
  /**
   * Optional regularization residual vector r_reg(params) such that:
   *   regularizationPenalty = (1 / N_exp) * sum(r_reg_k^2)
   *   regularizedObjective  = rawMse + regularizationPenalty
   * This keeps Raw MSE strictly separate from the regularization penalty.
   */
  regularizationResidualsFn?: (params: number[]) => number[];
  onIteration?: (
    iter: number,
    currentCost: number,
    prevCost: number | null,
    currentParams: number[],
    rawMse?: number,
    regularizationPenalty?: number
  ) => void;
  shouldStop?: () => boolean;
}

export interface OptimizerResult {
  converged: boolean;
  stopped: boolean;
  iterations: number;
  initialCost: number;
  finalCost: number;
  finalRawMse: number;
  finalRegularizationPenalty: number;
  finalParams: number[];
  message: string;
}

/**
 * Solve linear system (J^T * J + lambda * diag(J^T * J)) * delta = -J^T * r
 * using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented matrix
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    // Pivot selection
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) {
        maxVal = Math.abs(M[k][i]);
        maxRow = k;
      }
    }

    if (maxVal < 1e-14) {
      // Singular or near singular
      return null;
    }

    // Swap rows
    if (maxRow !== i) {
      const temp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = temp;
    }

    // Eliminate below
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) {
        M[k][j] -= factor * M[i][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }

  return x;
}

let lastUiYieldTime = 0;

/**
 * Bounded Levenberg-Marquardt Optimizer
 *
 * @param variables Array of parameters with initial values and [min, max] constraints
 * @param residualFn Evaluates experimental residual vector r_exp(params) where rawMse = (1/N_exp) * sum(r_exp_i^2)
 * @param options Optimization controls
 */
export async function optimizeBoundedLM(
  variables: OptimizationVariable[],
  residualFn: (params: number[]) => number[],
  options: OptimizerOptions = {}
): Promise<OptimizerResult> {
  const maxIterations = options.maxIterations ?? 40;
  const tol = options.tolerance ?? 1e-5;
  let lambda = options.initialLambda ?? 1e-2;
  const nParams = variables.length;

  if (nParams === 0) {
    const residual = residualFn([]);
    const raw = residual.reduce((s,r)=>s+r*r,0)/Math.max(1,residual.length);
    const reg = options.regularizationResidualsFn?.([])??[];
    const penalty = reg.reduce((s,r)=>s+r*r,0)/Math.max(1,residual.length);
    return {
      converged: true,
      stopped: false,
      iterations: 0,
      initialCost: raw + penalty,
      finalCost: raw + penalty,
      finalRawMse: raw,
      finalRegularizationPenalty: penalty,
      finalParams: [],
      message: 'No parameters selected for fitting.',
    };
  }

  // Normalize parameters to [0, 1] range to avoid ill-conditioning
  // u_i = (p_i - min_i) / (max_i - min_i)
  const toInternal = (params: number[]): number[] => {
    return params.map((p, i) => {
      const span = Math.max(1e-12, variables[i].max - variables[i].min);
      const clamped = Math.max(variables[i].min, Math.min(variables[i].max, p));
      return (clamped - variables[i].min) / span;
    });
  };

  const toPhysical = (u: number[]): number[] => {
    return u.map((ui, i) => {
      const clampedUi = Math.max(0, Math.min(1, ui));
      const span = variables[i].max - variables[i].min;
      return variables[i].min + clampedUi * span;
    });
  };

  const evaluateFullState = (params: number[]) => {
    const expRes = residualFn(params);
    const mExp = Math.max(1, expRes.length);
    const rawMse = expRes.reduce((acc, r) => acc + r * r, 0) / mExp;

    const regRes = options.regularizationResidualsFn ? options.regularizationResidualsFn(params) : [];
    const regPenalty = regRes.length > 0 ? regRes.reduce((acc, r) => acc + r * r, 0) / mExp : 0;

    const combinedResiduals = regRes.length > 0 ? [...expRes, ...regRes] : expRes;
    const totalCost = rawMse + regPenalty;

    return {
      expRes,
      regRes,
      combinedResiduals,
      mExp,
      rawMse,
      regPenalty,
      totalCost,
    };
  };

  const isAngularIdx = (idx: number, mExp: number): boolean => {
    if (idx >= mExp) return false;
    if (options.isAngularResidual) return options.isAngularResidual(idx);
    return idx % 2 === 1;
  };

  let currentParams = variables.map((v) => Math.max(v.min, Math.min(v.max, v.value)));
  let currentU = toInternal(currentParams);
  let currentState = evaluateFullState(currentParams);
  let currentResiduals = currentState.combinedResiduals;
  let currentCost = currentState.totalCost;
  let currentRawMse = currentState.rawMse;
  let currentRegPenalty = currentState.regPenalty;

  const initialCost = currentCost;
  let prevCost: number | null = null;

  let iter = 0;
  let converged = false;
  let stopped = false;

  while (iter < maxIterations) {
    if (options.shouldStop && options.shouldStop()) {
      stopped = true;
      break;
    }

    if (options.onIteration) {
      options.onIteration(iter, currentRawMse, prevCost, currentParams, currentRawMse, currentRegPenalty);
    }

    // Yield to browser event loop periodically without artificial 15ms sleep on every step
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastUiYieldTime > 25) {
      lastUiYieldTime = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const mResiduals = currentResiduals.length;
    const mExp = currentState.mExp;
    if (mResiduals === 0) break;

    // Compute Jacobian J in normalized u-space using finite differences
    const J: number[][] = Array.from({ length: mResiduals }, () => new Array(nParams).fill(0));
    const eps = 1e-4; // step in u-space

    for (let j = 0; j < nParams; j++) {
      const uPlus = [...currentU];
      uPlus[j] = Math.min(1, uPlus[j] + eps);
      const actualStep = uPlus[j] - currentU[j];

      if (actualStep < 1e-7) {
        // At upper boundary, step backwards
        const uMinus = [...currentU];
        uMinus[j] = Math.max(0, uMinus[j] - eps);
        const backStep = currentU[j] - uMinus[j];
        const stateMinus = evaluateFullState(toPhysical(uMinus));
        const rMinus = stateMinus.combinedResiduals;
        for (let i = 0; i < mResiduals; i++) {
          let stepDiff = currentResiduals[i] - rMinus[i];
          if (isAngularIdx(i, mExp)) {
            stepDiff = circularDifferenceDeg(currentResiduals[i], rMinus[i]);
          }
          J[i][j] = stepDiff / Math.max(1e-8, backStep);
        }
      } else {
        const statePlus = evaluateFullState(toPhysical(uPlus));
        const rPlus = statePlus.combinedResiduals;
        for (let i = 0; i < mResiduals; i++) {
          let stepDiff = rPlus[i] - currentResiduals[i];
          if (isAngularIdx(i, mExp)) {
            stepDiff = circularDifferenceDeg(rPlus[i], currentResiduals[i]);
          }
          J[i][j] = stepDiff / actualStep;
        }
      }
    }

    // Compute Approximate Hessian H = (1/mExp) * J^T * J and gradient g = (1/mExp) * J^T * r
    const H: number[][] = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
    const g: number[] = new Array(nParams).fill(0);
    const invMExp = 1.0 / mExp;

    for (let i = 0; i < nParams; i++) {
      let gradSum = 0;
      for (let k = 0; k < mResiduals; k++) {
        gradSum += J[k][i] * currentResiduals[k];
      }
      g[i] = gradSum * invMExp;

      for (let j = 0; j < nParams; j++) {
        let sum = 0;
        for (let k = 0; k < mResiduals; k++) {
          sum += J[k][i] * J[k][j];
        }
        H[i][j] = sum * invMExp;
      }
    }

    // Project gradient for active bound constraints:
    // If u_i == 0 and gradient points to u_i < 0 (i.e. -g_i < 0 => g_i > 0), or u_i == 1 and -g_i > 0 (g_i < 0)
    const projG = g.map((gi, i) => {
      if (currentU[i] <= 1e-8 && gi > 0) return 0;
      if (currentU[i] >= 1 - 1e-8 && gi < 0) return 0;
      return gi;
    });

    // Check projected gradient norm for convergence
    const gradNorm = Math.hypot(...projG);
    if (gradNorm < tol && iter >= 2) {
      converged = true;
      break;
    }

    // Form augmented matrix A = H + lambda * diag(H)
    // and solve A * delta = -g
    let stepAccepted = false;
    let trialAttempts = 0;

    while (!stepAccepted && trialAttempts < 8) {
      trialAttempts++;
      const A: number[][] = H.map((row, i) =>
        row.map((val, j) => {
          const isBlocked =
            (currentU[i] <= 1e-8 && g[i] > 0) || (currentU[i] >= 1 - 1e-8 && g[i] < 0);
          if (i === j) {
            if (isBlocked) return 1.0;
            const diagVal = Math.max(1e-6, Math.abs(val));
            return val + lambda * (diagVal + 1e-4);
          }
          if (isBlocked || (currentU[j] <= 1e-8 && g[j] > 0) || (currentU[j] >= 1 - 1e-8 && g[j] < 0)) {
            return 0.0;
          }
          return val;
        })
      );

      const rhs = projG.map((gi) => -gi);
      const deltaU = solveLinearSystem(A, rhs);

      if (deltaU) {
        // Project trial parameters to bounds [0, 1]
        const trialU = currentU.map((ui, i) => Math.max(0, Math.min(1, ui + deltaU[i])));
        const trialParams = toPhysical(trialU);
        const trialState = evaluateFullState(trialParams);
        const trialCost = trialState.totalCost;

        if (trialCost < currentCost - 1e-12) {
          // Successful step: accept update and decrease damping lambda
          prevCost = currentRawMse;
          const costImprovement = currentCost - trialCost;
          currentU = trialU;
          currentParams = trialParams;
          currentState = trialState;
          currentResiduals = trialState.combinedResiduals;
          currentCost = trialCost;
          currentRawMse = trialState.rawMse;
          currentRegPenalty = trialState.regPenalty;
          lambda = Math.max(1e-7, lambda / 3.0);
          stepAccepted = true;

          // Convergence criteria: cost improvement is below tolerance or gradient is flat
          if (
            (costImprovement < tol * Math.max(0.01, currentCost) || gradNorm < tol) &&
            iter >= 2
          ) {
            converged = true;
          }
        } else {
          // Unsuccessful step: increase lambda
          lambda = Math.min(1e6, lambda * 4.0);
        }
      } else {
        // System singular: increase lambda
        lambda = Math.min(1e6, lambda * 8.0);
      }
    }

    iter++;
    if (converged || !stepAccepted) break;
  }

  const improved = currentCost < initialCost - 1e-7;
  const message = stopped
    ? 'Fitting stopped by user.'
    : !improved
    ? 'Fitting failed to improve the objective function.'
    : converged
    ? `Converged successfully in ${iter} iterations.`
    : `Reached maximum iterations (${maxIterations}).`;

  return {
    converged: converged || improved,
    stopped,
    iterations: iter,
    initialCost,
    finalCost: currentCost,
    finalRawMse: currentRawMse,
    finalRegularizationPenalty: currentRegPenalty,
    finalParams: currentParams,
    message,
  };
}
