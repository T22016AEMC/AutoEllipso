/** Shared by all fitting modes; u = (p - min) / (max - min). */
export const FIT_NUMERICS = Object.freeze({
  ftol: 1e-9, xtol: 1e-9, gtol: 1e-9, costEpsilon: 1e-15,
  lambdaMax: 1e6, rcond: 1e-12, boundaryEpsilon: 1e-6,
  nonIdentifiableRatio: 1e-8, cautionCondition: 1e3, severeCondition: 1e5,
});
export type ConvergenceStatus = 'cost'|'step'|'gradient'|'no_better_step'|'stalled'|'max_iter'|'cancelled';
