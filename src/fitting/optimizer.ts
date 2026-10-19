/**
 * Bounded Nonlinear Least Squares Optimizer using Levenberg-Marquardt
 *
 * Designed specifically for physical models where parameter bounds [min, max]
 * and disparate physical scales (e.g. thickness in nm vs Cauchy B in μm²) must be strictly respected.
 */
import { circularDifferenceDeg } from './residual';
import { solveLeastSquaresSvd } from './svd';
import { FIT_NUMERICS, ConvergenceStatus } from './numerics';

export interface OptimizationVariable {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
}

export interface OptimizerOptions {
  residualWeights?: number[];
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
    regularizationPenalty?: number,
    weightedCost?: number
  ) => void;
  shouldStop?: () => boolean;
}

export interface OptimizerResult {
  status: ConvergenceStatus;
  truncatedSingularValues: number;
  converged: boolean;
  improved: boolean;
  stopped: boolean;
  iterations: number;
  initialCost: number;
  finalCost: number;
  finalRawMse: number;
  finalWeightedCost: number;
  finalChiSquare: number;
  finalRegularizationPenalty: number;
  finalParams: number[];
  message: string;
}

/** Unweighted residual Jacobian in normalized u-space; exported for analytic regression tests. */
export function centralDifferenceJacobian(variables:OptimizationVariable[],params:number[],residualFn:(p:number[])=>number[],isAngularResidual=(i:number)=>i%2===1):number[][] {
  const base=residualFn(params),J=base.map(()=>variables.map(()=>0));
  variables.forEach((v,j)=>{
    const span=v.max-v.min;if(span<=0)return;
    const u=Math.max(0,Math.min(1,(params[j]-v.min)/span));
    const hu=Math.max(1e-5*span,1e-4*Math.abs(params[j]),1e-12)/span;
    const central=u-hu>=0&&u+hu<=1;
    const forward=central||u+hu<=1||(u-hu<0&&1-u>=u);
    const step=central?hu:Math.min(hu,forward?1-u:u);
    if(step<=0)return;
    const plus=[...params],minus=[...params];
    plus[j]=v.min+(central||forward?u+step:u)*span;
    minus[j]=v.min+(central||!forward?u-step:u)*span;
    const rp=central||forward?residualFn(plus):base,rm=central||!forward?residualFn(minus):base;
    if(rp.length!==base.length||rm.length!==base.length)throw new Error('Residual count changed during Jacobian evaluation');
    for(let i=0;i<base.length;i++) J[i][j]=(isAngularResidual(i)?circularDifferenceDeg(rp[i],rm[i]):rp[i]-rm[i])/(central?2*step:step);
  });
  return J;
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
  const {ftol,xtol,gtol,costEpsilon,lambdaMax}=FIT_NUMERICS;
  let lambda = options.initialLambda ?? 1e-2;
  const nParams = variables.length;

  // Normalize parameters to [0, 1] range to avoid ill-conditioning
  // u_i = (p_i - min_i) / (max_i - min_i)
  const toInternal = (params: number[]): number[] => {
    return params.map((p, i) => {
      const span = variables[i].max - variables[i].min;
      const clamped = Math.max(variables[i].min, Math.min(variables[i].max, p));
      return span>0?(clamped - variables[i].min) / span:0;
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
    if (options.residualWeights && (options.residualWeights.length!==expRes.length || options.residualWeights.some(w=>!Number.isFinite(w)||w<0))) throw new Error('residualWeights must be finite, nonnegative and match data residual count');
    const weights=options.residualWeights??expRes.map(()=>1);
    const meanW2=options.residualWeights?weights.reduce((s,w)=>s+w*w,0)/mExp:1;
    const chiSquare=expRes.reduce((s,r,i)=>s+(weights[i]*r)**2,0);
    const weightedCost=chiSquare/mExp;
    const rawMse = expRes.reduce((acc, r) => acc + r * r, 0) / mExp;

    const regRes = options.regularizationResidualsFn ? options.regularizationResidualsFn(params) : [];
    const regPenalty = regRes.length > 0 ? regRes.reduce((acc, r) => acc + r * r, 0) / mExp * meanW2 : 0;

    const rowWeights=[...weights,...regRes.map(()=>Math.sqrt(meanW2))];
    const combinedResiduals=[...expRes,...regRes].map((r,i)=>r*rowWeights[i]);
    const totalCost = weightedCost + regPenalty;

    return {
      expRes,
      regRes,
      rowWeights,weightedCost,chiSquare,
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
  if (nParams===0) return {truncatedSingularValues:0,status:'gradient',converged:true,improved:false,stopped:false,iterations:0,initialCost,finalCost:currentCost,
    finalRawMse:currentRawMse,finalWeightedCost:currentState.weightedCost,finalChiSquare:currentState.chiSquare,
    finalRegularizationPenalty:currentRegPenalty,finalParams:[],message:'Converged: no free parameters.'};
  let prevCost: number | null = null;

  let iter = 0;
  let converged = false;
  let stopped = false;
  let status:ConvergenceStatus='max_iter';
  let truncatedSingularValues=0;

  while (iter < maxIterations) {
    if (options.shouldStop && options.shouldStop()) {
      stopped = true;
      status = 'cancelled';
      break;
    }

    if (options.onIteration) {
      options.onIteration(iter, currentRawMse, prevCost, currentParams, currentRawMse, currentRegPenalty, currentState.weightedCost);
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

    // Difference unweighted degrees first, then apply weights (never wrap weighted Delta).
    const J=centralDifferenceJacobian(variables,currentParams,params=>{
      const state=evaluateFullState(params);return [...state.expRes,...state.regRes];
    },i=>isAngularIdx(i,mExp)).map((row,i)=>row.map(v=>v*currentState.rowWeights[i]));

    const mScale=Math.sqrt(mExp);
    const g=variables.map((_,j)=>J.reduce((sum,row,i)=>sum+row[j]*currentResiduals[i],0)/mExp);
    const diagonal=variables.map((_,j)=>J.reduce((sum,row)=>sum+row[j]**2,0)/mExp);

    // Project gradient for active bound constraints:
    // If u_i == 0 and gradient points to u_i < 0 (i.e. -g_i < 0 => g_i > 0), or u_i == 1 and -g_i > 0 (g_i < 0)
    const projG = g.map((gi, i) => {
      if (currentU[i] <= 1e-8 && gi > 0) return 0;
      if (currentU[i] >= 1 - 1e-8 && gi < 0) return 0;
      return gi;
    });

    // Check projected gradient norm for convergence
    const gradNorm = Math.max(0,...projG.map(Math.abs));
    const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);
    if (gradNorm < gradientTolerance) {
      converged = true;
      status = 'gradient';
      break;
    }

    // Form augmented matrix A = H + lambda * diag(H)
    // and solve A * delta = -g
    let stepAccepted = false;
    let trialAttempts = 0;

    while (!stepAccepted) {
      trialAttempts++;
      const free=variables.map((_,i)=>i).filter(i=>!((currentU[i]<=1e-8&&g[i]>0)||(currentU[i]>=1-1e-8&&g[i]<0)));
      // Identical Marquardt diagonal: max(1e-6, H_jj) + 1e-4; no normal equations.
      const augmented=J.map(row=>free.map(j=>row[j]/mScale));
      for(let k=0;k<free.length;k++)augmented.push(free.map((j,l)=>l===k?Math.sqrt(lambda*(Math.max(1e-6,diagonal[j])+1e-4)):0));
      const rhs=[...currentResiduals.map(r=>-r/mScale),...free.map(()=>0)];
      const solved=solveLeastSquaresSvd(augmented,rhs);
      truncatedSingularValues=Math.max(truncatedSingularValues,solved.truncated);
      const deltaU=variables.map(()=>0);
      free.forEach((j,k)=>deltaU[j]=solved.solution[k]);

      if (deltaU) {
        // Project trial parameters to bounds [0, 1]
        const trialU = currentU.map((ui, i) => Math.max(0, Math.min(1, ui + deltaU[i])));
        const trialParams = toPhysical(trialU);
        const trialState = evaluateFullState(trialParams);
        const trialCost = trialState.totalCost;

        if (trialCost < currentCost) {
          // Successful step: accept update and decrease damping lambda
          prevCost = currentRawMse;
          const costImprovement = currentCost - trialCost;
          const relativeImprovement=costImprovement/Math.max(currentCost,costEpsilon);
          const stepNorm=Math.hypot(...trialU.map((u,i)=>u-currentU[i]));
          currentU = trialU;
          currentParams = trialParams;
          currentState = trialState;
          currentResiduals = trialState.combinedResiduals;
          currentCost = trialCost;
          currentRawMse = trialState.rawMse;
          currentRegPenalty = trialState.regPenalty;
          lambda = Math.max(1e-7, lambda / 3.0);
          stepAccepted = true;

          if (relativeImprovement < ftol || stepNorm < xtol) {
            converged = true;
            status=relativeImprovement<ftol?'cost':'step';
          }
        } else {
          // Unsuccessful step: increase lambda
          if(lambda===lambdaMax)break;
          lambda = Math.min(lambdaMax, lambda * 4.0);
        }
      } else {
        // System singular: increase lambda
        if(lambda===lambdaMax)break;
        lambda = Math.min(lambdaMax, lambda * 8.0);
      }
    }

    iter++;
    if(!stepAccepted) {
      converged=gradNorm<100*gradientTolerance;
      status=converged?'no_better_step':'stalled';
    }
    if (converged || !stepAccepted) break;
  }

  const improved = currentCost < initialCost;
  const message = stopped
    ? 'Fitting stopped by user.'
    : converged
    ? `Converged (${status}) in ${iter} iterations.`
    : !improved
    ? 'Fitting failed to improve the objective function.'
    : `${status === 'stalled'?'Stalled':'Reached maximum iterations ('+maxIterations+')'}; not converged.`;

  return {
    status,
    truncatedSingularValues,
    converged,
    improved,
    stopped,
    iterations: iter,
    initialCost,
    finalCost: currentCost,
    finalRawMse: currentRawMse,
    finalWeightedCost:currentState.weightedCost,
    finalChiSquare:currentState.chiSquare,
    finalRegularizationPenalty: currentRegPenalty,
    finalParams: currentParams,
    message,
  };
}
