/** Open clamped cubic B-splines. Locations define the nonuniform control grid. */
export function cubicKnotVector(locations: number[]): number[] {
  if (locations.length < 4 || locations.some((x,i) => !Number.isFinite(x) || (i > 0 && x <= locations[i-1])))
    throw new Error('Cubic spline needs at least four strictly increasing control locations');
  const m = locations.length;
  const knots = Array(4).fill(locations[0]);
  for (let j=1; j<=m-4; j++) knots.push((locations[j]+locations[j+1]+locations[j+2])/3);
  return [...knots, ...Array(4).fill(locations[m-1])];
}
export function cubicBasis(x: number, locations: number[]): number[] {
  const t = cubicKnotVector(locations), m = locations.length;
  if (x <= t[0]) return Array.from({length:m},(_,i)=> i===0 ? 1 : 0);
  if (x >= t[t.length-1]) return Array.from({length:m},(_,i)=> i===m-1 ? 1 : 0);
  let b: number[] = t.slice(0,-1).map((v,i)=>v<=x && x<t[i+1] ? 1 : 0);
  for (let p=1;p<=3;p++) b=b.slice(0,-1).map((_,i)=>
    (t[i+p]===t[i] ? 0 : (x-t[i])/(t[i+p]-t[i])*b[i])+
    (t[i+p+1]===t[i+1] ? 0 : (t[i+p+1]-x)/(t[i+p+1]-t[i+1])*b[i+1]));
  return b;
}
export function cubicEvaluate(x: number, locations: number[], coefficients: number[]): number {
  if (coefficients.length !== locations.length) throw new Error('Spline coefficient count mismatch');
  return cubicBasis(x,locations).reduce((sum,b,i)=>sum+b*coefficients[i],0);
}
