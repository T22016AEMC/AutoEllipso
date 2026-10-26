"""Offline v2 audit. Reference arrays exist only in RAM and worker stdin."""
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import yaml
from scipy.interpolate import PchipInterpolator, CubicSpline, interp1d

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.qa'
PREFIX = 'stage4_9b-v2-'
S = json.loads((QA / 'stage4_9b-settings.json').read_text(encoding='utf-8'))


class RequestedPause(Exception):
    pass


def check_pause():
    if (QA / (PREFIX+'pause-request.json')).exists():
        raise RequestedPause('user pause requested; previous worker checkpoint saved, no new worker started')


def read(name):
    return json.loads((QA / (PREFIX + name + '.json')).read_text(encoding='utf-8'))


def save(name, value, replace=False):
    path = QA / (PREFIX + name + '.json')
    assert replace or not path.exists(), 'saved result cannot be rerun/overwritten: ' + name
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8', newline='')
    temporary.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def guard():
    frozen = read('frozen')
    assert Path(sys.executable).resolve() == Path(S['python']).resolve()
    assert sha(QA / 'stage4_9b-settings.json') == frozen['settings_sha256']
    assert sha(QA / (PREFIX + 'settings.json')) == frozen['settings_sha256']
    assert sha(QA / (PREFIX + 'frozen-report.md')) == frozen['report_sha256']
    assert sha(Path(S['si_final']['path'])) == frozen['si_final_sha256']
    for path, expected in frozen['src'].items():
        assert sha(ROOT / path) == expected, 'src changed: ' + path
    for path, expected in frozen['references'].items():
        assert sha(Path(path)) == expected, 'reference changed: ' + path
    assert sha(QA / 'stage4_9a-pchip-reference-check.json') == frozen['prior_pchip_sha256']


def nk(epsilon):
    e = np.asarray(epsilon)
    assert np.isfinite(e).all() and np.all(e.imag >= 0), 'invalid epsilon; no correction or extrapolation'
    # Match v1's real-array magnitude arithmetic, including near-transparent cancellation.
    magnitude = np.hypot(e.real, e.imag)
    return np.column_stack([np.sqrt((magnitude + e.real) / 2), np.sqrt((magnitude - e.real) / 2)])


def stats(grid, values):
    values = np.asarray(values)
    if not len(values):
        return None
    assert np.isfinite(values).all()
    index = int(np.argmax(abs(values)))
    return {'maxAbs': float(abs(values[index])), 'at_nm': float(grid[index]),
            'rms': float(np.sqrt(np.mean(abs(values) ** 2))), 'bias': float(np.mean(values.real))}


def bands(grid, errors):
    result = []
    for lo, hi, closed in S['bands'] + [[190, S['hc_eVnm'] / 6.5, False]]:
        mask = (grid >= lo) & ((grid <= hi) if closed else (grid < hi))
        result.append({'band': [lo, hi, closed], 'points': int(mask.sum()),
                       **{key: stats(grid[mask], values[mask]) for key, values in errors.items()}})
    return result


def annotations(value, component):
    if component == 'thickness':
        return {'belowInterpFloor': None, 'label': 'NA／無法判定'}
    floor = read('stage0')['interp_floor'][component]
    below = abs(value) < floor
    result = {'belowInterpFloor': bool(below), 'interpFloor': floor,
              'label': '無法與內插不確定度區分' if below else '未小於interp_floor'}
    if component in ['psi', 'delta']:
        lower = max(floor, read('stage0')['historical_linear_pchip_forward'][component]['maxAbs'])
        result.update({'inferenceLowerBound': lower, 'belowInferenceLowerBound': bool(abs(value) < lower)})
    return result


def annotate_regions(regions):
    for row in regions:
        for component in ['n', 'k', 'psi', 'delta', 'epsilon']:
            value = row.get(component)
            if value:
                value['annotations'] = {m: annotations(value[m], component) for m in ['maxAbs', 'rms']}
    return regions


class Tables:
    def __init__(self):
        lines = Path(S['si_final']['path']).read_text(encoding='utf-8-sig').splitlines()
        self.native = np.array([[float(v) for v in line.split()] for line in lines[3:] if line.strip()])
        assert self.native.shape[1] == 3 and np.isfinite(self.native).all()
        assert np.all(np.diff(self.native[:, 0]) < 0)
        controls = self.native[::-1].copy()
        controls[controls[:, 0] < 1, 2] = 0
        self.energy = controls[:, 0]
        self.epsilon = controls[:, 1] + 1j * controls[:, 2]
        self.native_methods = {
            'linear': interp1d(self.energy, self.epsilon, bounds_error=True),
            'pchip': (PchipInterpolator(self.energy, controls[:, 1], extrapolate=False), PchipInterpolator(self.energy, controls[:, 2], extrapolate=False)),
            'cs': CubicSpline(self.energy, self.epsilon, bc_type='not-a-knot', extrapolate=False)}
        registration = json.loads((QA / 'stage4_9a-registration.json').read_text(encoding='utf-8'))
        self.references = {}
        for requested in S['references']:
            row = next(x for x in registration['registration'] if x['entry'] == requested['id'])
            source = yaml.safe_load(Path(row['path']).read_text(encoding='utf-8-sig'))
            block = next(x for x in source['DATA'] if x['type'] == 'tabulated nk')
            a = np.array([[float(v) for v in line.split()] for line in block['data'].splitlines() if line.strip()])
            self.references[requested['id']] = (a[:, 0] * 1000, PchipInterpolator(a[:, 0] * 1000, a[:, 1:3], axis=0, extrapolate=False))
        dense = np.arange(190, 901, dtype=float)
        self.dense_method = self.interpolator(dense, self.native_epsilon(dense), 'epsilon-energy PCHIP')
        controls = np.arange(190, 901, 5, dtype=float)
        self.candidate1 = self.interpolator(controls, self.dense_method(controls), 'epsilon-energy PCHIP')
        self.candidate3 = None
        self.application_cache = None

    def native_at_energy(self, energy, method='pchip'):
        assert np.min(energy) >= self.energy[0] and np.max(energy) <= self.energy[-1]
        f = self.native_methods[method]
        values = np.asarray(f[0](energy) + 1j * f[1](energy) if isinstance(f, tuple) else f(energy)).copy()
        values[energy < 1] = values[energy < 1].real
        assert np.isfinite(values).all()
        return values

    def native_epsilon(self, wavelengths, method='pchip'):
        return self.native_at_energy(S['hc_eVnm'] / np.asarray(wavelengths), method)

    def reference_epsilon(self, name, grid):
        controls, f = self.references[name]
        assert np.min(grid) >= controls[0] and np.max(grid) <= controls[-1], 'reference out of range'
        values = f(grid)
        assert np.isfinite(values).all() and np.all(values[:, 1] >= 0)
        return (values[:, 0] + 1j * values[:, 1]) ** 2

    def truth(self, name, grid):
        if name == 'Si-final':
            return self.dense_method(grid)
        if name == 'SiF-cs':
            return self.native_epsilon(grid, 'cs')
        return self.reference_epsilon(name, grid)

    def candidate(self, name, grid):
        if name == 'C0':
            if self.application_cache is None:
                original = execute({'task': 'application', 'grid': list(range(190, 1001))})
                self.application_cache = {x['wavelength']: x['n'] + 1j*x['k'] for x in original}
            lookup = self.application_cache
            assert all(float(w) in lookup for w in grid)
            return np.array([lookup[float(w)] ** 2 for w in grid])
        if name == 'C1':
            return self.candidate1(grid)
        if name == 'C2':
            return self.dense_method(grid)
        if self.candidate3 is None:
            controls = np.unique(np.concatenate([np.arange(190, 1001), [206.6, 207, 212, 822, 826.6, 827]]))
            values = np.empty(len(controls), dtype=complex)
            for i, w in enumerate(controls):
                g = np.array([w])
                if w < 206.6:
                    values[i] = self.native_epsilon(g)[0]
                elif w <= 212:
                    weight = .5 * (1 - np.cos(np.pi * (w - 206.6) / (212 - 206.6)))
                    values[i] = (1 - weight) * self.native_epsilon(g)[0] + weight * self.reference_epsilon('Aspnes', g)[0]
                elif w < 822:
                    values[i] = self.reference_epsilon('Aspnes', g)[0]
                elif w <= 826.6:
                    weight = .5 * (1 - np.cos(np.pi * (w - 822) / (826.6 - 822)))
                    values[i] = (1 - weight) * self.reference_epsilon('Aspnes', g)[0] + weight * self.reference_epsilon('Green-2008', g)[0]
                else:
                    values[i] = self.reference_epsilon('Green-2008', g)[0]
            initial = self.interpolator(controls, values, 'epsilon-energy PCHIP')
            dense = np.arange(190, 1001, dtype=float)
            self.candidate3 = self.interpolator(dense, initial(dense), 'epsilon-energy PCHIP')
        return self.candidate3(grid)

    @staticmethod
    def interpolator(wavelength, epsilon, method):
        wavelength = np.asarray(wavelength, dtype=float)
        values = np.asarray(epsilon)
        if method == 'n/k-lambda linear':
            a = nk(values)
            f = interp1d(wavelength, a, axis=0, bounds_error=True)
            return lambda grid: (f(grid)[:, 0] + 1j * f(grid)[:, 1]) ** 2
        x = S['hc_eVnm'] / wavelength if '-energy ' in method else wavelength
        order = np.argsort(x)
        if method.endswith('linear'):
            f = interp1d(x[order], values[order], bounds_error=True)
            return lambda grid: f(S['hc_eVnm'] / grid if '-energy ' in method else grid)
        re = PchipInterpolator(x[order], values[order].real, extrapolate=False)
        im = PchipInterpolator(x[order], values[order].imag, extrapolate=False)
        def evaluate(grid):
            q = S['hc_eVnm'] / grid if '-energy ' in method else grid
            assert np.min(q) >= min(x) - 1e-12 and np.max(q) <= max(x) + 1e-12
            out = re(q) + 1j * im(q)
            assert np.isfinite(out).all()
            return out
        return evaluate


def forward(grid, a, b):
    check_pause()
    aa, bb = nk(a), nk(b)
    points = [{'wavelength': float(w), 'linear': {'n': float(x[0]), 'k': float(x[1])}, 'pchip': {'n': float(y[0]), 'k': float(y[1])}} for w, x, y in zip(grid, aa, bb)]
    response = subprocess.run([shutil.which('node'), '--import', 'tsx', 'scripts/stage4_9b-forward.ts'], input=json.dumps({'points': points}), text=True, encoding='utf-8', capture_output=True, cwd=ROOT)
    assert response.returncode == 0, response.stderr
    return json.loads(response.stdout)


def execute(request):
    check_pause()
    result = subprocess.run([shutil.which('node'), '--import', 'tsx', 'scripts/stage4_9b-worker.ts'],
                            input=json.dumps(request), text=True, encoding='utf-8', capture_output=True, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)


def stage0(tables):
    start = time.monotonic()
    grid = np.arange(190, 901, dtype=float)
    p, c = tables.native_epsilon(grid), tables.native_epsilon(grid, 'cs')
    pn, cn = nk(p), nk(c)
    epsilon_regions = bands(grid, {'epsilon': p-c, 'n': pn[:, 0]-cn[:, 0], 'k': pn[:, 1]-cn[:, 1]})
    dense_stats = {key: stats(grid, values) for key, values in {'epsilon': p-c, 'n': pn[:, 0]-cn[:, 0], 'k': pn[:, 1]-cn[:, 1], 'epsilon1': (p-c).real, 'epsilon2': (p-c).imag}.items()}
    native_grid = np.unique(np.concatenate([np.linspace(a, b, 101) for a, b in zip(tables.energy[:-1], tables.energy[1:])]))
    diff = tables.native_at_energy(native_grid)-tables.native_at_energy(native_grid, 'cs')
    wavelength = S['hc_eVnm']/native_grid
    native_stats = {key: stats(wavelength, values) for key, values in {'epsilon': diff, 'epsilon1': diff.real, 'epsilon2': diff.imag}.items()}
    measured_grid = np.array(S['stage0_forward_gate']['wavelengths_nm'], dtype=float)
    lp = forward(measured_grid, tables.native_epsilon(measured_grid, 'linear'), tables.native_epsilon(measured_grid))
    pc = forward(measured_grid, tables.native_epsilon(measured_grid), tables.native_epsilon(measured_grid, 'cs'))
    old = json.loads((QA / 'stage4_9b-v1-native-forward-interpolation.json').read_text(encoding='utf-8'))
    assert lp == old, 'authorized rerun must reproduce saved v1 forward values exactly'
    floor = {key: dense_stats[key]['maxAbs'] for key in ['n', 'k', 'epsilon']}
    floor.update({key: pc['global'][key]['maxAbs'] for key in ['psi', 'delta']})
    save('stage0', {'elapsed_seconds': time.monotonic()-start, 'interp_floor': floor, 'thickness_interp_floor': 'NA／無法判定', 'historical_linear_pchip_forward': lp['global'], 'linear_pchip': lp, 'pchip_cs': pc, 'dense_stats': dense_stats, 'native_stats': native_stats, 'regions': epsilon_regions, 'report_only_no_stop': True, 'authorized_rerun_scope': 'stage0 v1->v2 only; same old forward output, plus CS sensitivity', 'saved_fits_rerun': 0})


def stage1(tables):
    started = time.monotonic()
    grid = np.arange(190, 901, dtype=float)
    primary = nk(tables.dense_method(grid))
    rows = []
    for item in [{'id': 'C0', 'lo': 190, 'hi': 900}] + S['references']:
        g = grid[(grid >= item['lo']) & (grid <= item['hi'])]
        compare = nk(tables.candidate('C0', g) if item['id'] == 'C0' else tables.truth(item['id'], g))
        truth = primary[(grid >= item['lo']) & (grid <= item['hi'])]
        row = {'id': item['id'], 'regions': annotate_regions(bands(g, {'n': compare[:, 0]-truth[:, 0], 'k': compare[:, 1]-truth[:, 1]}))}
        rows.append(row)
    floor = []
    for index in range(len(rows[0]['regions'])):
        record = {'band': rows[0]['regions'][index]['band']}
        for key in ['n', 'k']:
            values = [r['regions'][index][key] for r in rows[1:] if r['regions'][index][key]]
            record[key] = {metric: max(x[metric] for x in values) for metric in ['maxAbs', 'rms']} if values else None
        floor.append(record)
    for i, r in enumerate(rows[0]['regions']):
        r['ratios_to_floor_lit'] = {key: {m: r[key][m]/floor[i][key][m] if floor[i][key] and floor[i][key][m]>0 else None for m in ['maxAbs', 'rms']} for key in ['n', 'k']}
    save('stage1', {'elapsed_seconds': time.monotonic()-started, 'comparisons': rows, 'floor_lit': floor})


def stage2(tables):
    started = time.monotonic()
    dense = np.arange(190, 901, dtype=float)
    truth = nk(tables.dense_method(dense))
    fgrid = np.arange(190, 901, 10, dtype=float)
    results = []
    for family, steps in [('lambda', S['stage2_lambda_steps_nm']), ('energy', S['stage2_energy_steps_eV'])]:
        lo, hi = (190, 900) if family == 'lambda' else (S['hc_eVnm']/900, S['hc_eVnm']/190)
        for spacing in steps:
            nodes = np.arange(lo, hi+1e-10, spacing)
            if abs(nodes[-1]-hi)>1e-9:
                nodes = np.append(nodes, hi)
            controls = nodes if family == 'lambda' else (S['hc_eVnm']/nodes)[::-1]
            for method in S['stage2_methods']:
                key = 's2-'+family+'-'+str(spacing)+'-'+method.replace('/', '').replace(' ', '_')
                path = QA / (PREFIX+key+'.json')
                if path.exists():
                    results.append(read(key)); continue
                interpolator = tables.interpolator(controls, tables.dense_method(controls), method)
                fitted = nk(interpolator(dense))
                regions = annotate_regions(bands(dense, {'n': fitted[:, 0]-truth[:, 0], 'k': fitted[:, 1]-truth[:, 1]}))
                f = forward(fgrid, interpolator(fgrid), tables.dense_method(fgrid))
                for region in f['bands'] + [f['global'], f['extrapolated']]:
                    for component in ['psi', 'delta']:
                        if region[component]:
                            region[component]['annotations'] = {m: annotations(region[component][m], component) for m in ['maxAbs','rms']}
                result = {'family': family, 'spacing': spacing, 'method': method, 'nodes': len(controls), 'last_interval_shortened': bool(abs(nodes[-1]-nodes[-2]-spacing)>1e-9), 'regions': regions, 'forward': f, 'forward_flag': max(f['global'][c]['maxAbs'] for c in ['psi','delta'])>.03, 'strict_below_03': all(f['global'][c]['maxAbs']<.03 for c in ['psi','delta'])}
                save(key, result); results.append(result)
    assert len(results)==55
    coarsest = []
    for family in ['lambda','energy']:
        for method in S['stage2_methods']:
            eligible = [r['spacing'] for r in results if r['family']==family and r['method']==method and r['strict_below_03']]
            coarsest.append({'family':family,'method':method,'coarsest_tested':max(eligible) if eligible else None})
    save('stage2', {'elapsed_seconds':time.monotonic()-started,'results':results,'coarsest_tested':coarsest})


def optical_rows(grid, epsilon):
    values = nk(epsilon)
    return [{'wavelength':float(w),'n':float(p[0]),'k':float(p[1])} for w,p in zip(grid,values)]


def request_case(tables, truth, candidate, film, thickness, seed, domain, fit_range=None, statistics=False):
    grid = np.arange(domain[0],domain[1]+1,10,dtype=float)
    fit_range = fit_range or domain
    dense = np.arange(fit_range[0],fit_range[1]+1,dtype=float)
    fitted = []
    if candidate != 'C0':
        if candidate in ['C1','C2','C3']:
            epsilon = tables.candidate(candidate,dense)
        else:
            epsilon = tables.truth(candidate,dense)
        fitted = optical_rows(dense,epsilon)
    return {'task':'local','truth':truth,'candidate':candidate,'film':film,'thickness':thickness,'seed':seed,
            'truthSi':optical_rows(grid,tables.truth(truth,grid)),'fitSi':fitted,
            'fitRange':fit_range,'statistics':statistics}


def run_job(key, request, meta):
    guard()
    if (QA/(PREFIX+key+'.json')).exists():
        return read(key),True
    output = execute(request)
    output['meta'] = meta
    output['errors']['regions'] = annotate_regions(output['errors']['regions'])
    error = output['errors']
    error['thickness_annotation'] = annotations(error['thicknessError'],'thickness')
    output['flags'] = {'thickness':abs(error['thicknessError'])>.1,
                       'n':[r['n']['maxAbs']>.01 if r['n'] else None for r in error['regions']]}
    if 'forward' in output:
        annotate_regions(output['forward'])
        output['flags']['forward'] = [max(r[c]['maxAbs'] for c in ['psi','delta'])>.03 if r['points'] else None for r in output['forward']]
    if 'uncertainty' in output:
        annotate_regions(output['uncertainty'])
    save(key,output)
    return output,False


def aggregate_jobs(jobs):
    output = []
    for band_index in range(len(S['bands'])+1):
        band = S['bands'][band_index] if band_index<len(S['bands']) else [190,S['hc_eVnm']/6.5,False]
        lo,hi,closed=band
        record={'band':band,'datasets':sum(j['errors']['regions'][band_index]['points']>0 for j in jobs)}
        for name in ['n','k','psi','delta']:
            grid,values=[],[]
            for job in jobs:
                rows = job['errors']['rows'] if name in ['n','k'] else job['forwardRows']
                key = {'n':'nError','k':'kError','psi':'psiError','delta':'deltaError'}[name]
                for row in rows:
                    if row['wavelength']>=lo and (row['wavelength']<=hi if closed else row['wavelength']<hi):
                        grid.append(row['wavelength']);values.append(row[key])
            record[name]=stats(np.array(grid),np.array(values))
        thickness = [j['errors']['thicknessError'] for j in jobs if j['errors']['regions'][band_index]['points']>0]
        record['thickness']={'maxAbs':max(abs(x) for x in thickness),'rms':float(np.sqrt(np.mean(np.square(thickness)))),'annotation':annotations(0,'thickness')} if thickness else None
        output.append(record)
    return annotate_regions(output)


def stage3(tables):
    started=time.monotonic()
    jobs=[]; keys=[]
    for ti,truth in enumerate(S['truths']):
        for fi,film in enumerate(S['films']):
            for di,thickness in enumerate(S['thicknesses_nm']):
                seed=60001+100*ti+10*fi+di
                for candidate in ['C0','C1','C2','C3']:
                    key=f's3-{truth["id"]}-{fi}-{thickness}-{candidate}'
                    meta={'truth':truth['id'],'candidate':candidate,'film':film['id'],'thickness':thickness,'seed':seed,'domain':[truth['lo'],truth['hi']],
                          'self_consistent':truth['id']=='Si-final' and candidate in ['C1','C2'],'sensitivity_only':False}
                    request=request_case(tables,truth['id'],candidate,fi,thickness,seed,meta['domain'])
                    result,cached=run_job(key,request,meta)
                    jobs.append(result);keys.append(key)
                    save('progress',{'stage':3,'completed':len(keys),'total':148,'latest':key},replace=True)
    extra=[]
    for candidate in ['C0','C1','C2','C3']:
        key='s3-SiF-cs-0-60-'+candidate
        meta={'truth':'SiF-cs','candidate':candidate,'film':'Cauchy','thickness':60,'seed':60002,'domain':[190,900],'self_consistent':False,'sensitivity_only':True}
        result,cached=run_job(key,request_case(tables,'SiF-cs',candidate,0,60,60002,[190,900]),meta)
        keys.append(key);extra.append(result)
        save('progress',{'stage':3,'completed':len(keys),'total':148,'latest':key},replace=True)
    assert len(keys)==148
    aggregates=[]
    for candidate in ['C0','C1','C2','C3']:
        cohort=[j for j in jobs if j['meta']['candidate']==candidate and not j['meta']['self_consistent']]
        truths={j['meta']['truth'] for j in cohort}
        baseline=[j for j in jobs if j['meta']['candidate']=='C0' and j['meta']['truth'] in truths]
        regions=aggregate_jobs(cohort);c0=aggregate_jobs(baseline)
        for index,row in enumerate(regions):
            row['C0_ratios']={c:{m:row[c][m]/c0[index][c][m] if row[c] and c0[index][c] and c0[index][c][m]>0 else None for m in ['maxAbs','rms']} for c in ['n','k','psi','delta','thickness']}
        aggregates.append({'candidate':candidate,'datasets':len(cohort),'truth_cohort':sorted(truths),'regions':regions})
    compact_metrics=[]
    for candidate in ['C1','C2']:
        errors=[]
        for ref in S['references']:
            grid=np.arange(ref['lo'],ref['hi']+1,dtype=float)
            a,b=nk(tables.candidate(candidate,grid)),nk(tables.truth(ref['id'],grid))
            errors.append(bands(grid,{'n':a[:,0]-b[:,0],'k':a[:,1]-b[:,1]}))
        summary=[]
        for i in range(len(S['bands'])+1):
            summary.append({c:{m:max(r[i][c][m] for r in errors if r[i][c]) if any(r[i][c] for r in errors) else None for m in ['maxAbs','rms']} for c in ['n','k']})
        compact_metrics.append({'candidate':candidate,'regions':summary})
    compact=[]
    for index,floor in enumerate(read('stage1')['floor_lit']):
        row={'band':floor['band'],'comparisons':{}}
        for c in ['n','k']:
            for m in ['maxAbs','rms']:
                a,b=[r['regions'][index][c][m] for r in compact_metrics]
                base=floor[c][m] if floor[c] else None
                delta=abs(a-b) if a is not None and b is not None else None
                row['comparisons'][c+'_'+m]={'difference':delta,'floor_lit':base,'less_than_10_percent':delta<.1*base if delta is not None and base is not None and base>0 else None}
        compact.append(row)
    defined=[v['less_than_10_percent'] for r in compact for v in r['comparisons'].values() if v['less_than_10_percent'] is not None]
    thickness_sensitivity=[]
    for j in extra:
        baseline=next(x for x in jobs if x['meta']['truth']=='Si-final' and x['meta']['film']=='Cauchy' and x['meta']['thickness']==60 and x['meta']['candidate']==j['meta']['candidate'])
        assert j['points']==baseline['points'] or j['meta']['seed']==baseline['meta']['seed']
        thickness_sensitivity.append({'candidate':j['meta']['candidate'],'signed_cs_minus_pchip_nm':j['thickness']-baseline['thickness'],'scope':'Cauchy60 only; shared60002 noise; sensitivity sample, never a floor'})
    save('stage3',{'elapsed_seconds':time.monotonic()-started,'keys':keys,'total_local_fits':148,'aggregates':aggregates,'compact_metrics':compact_metrics,'compact_comparison':compact,'compact_sufficient_substrate_nk_only':all(defined) if defined else None,'thickness_sensitivity':thickness_sensitivity})


def stage4(tables):
    started=time.monotonic();records=[];unique=set()
    for fi,film in enumerate(S['films']):
        for substrate in S['stage4']['substrates']:
            for label,domain in zip(['A','B','C','D'],S['stage4']['ranges'][substrate]):
                key=f's4-{fi}-{substrate}-{domain[0]}-{domain[1]}'
                meta={'truth':'Si-final','candidate':substrate,'film':film['id'],'thickness':60,'seed':S['stage4']['seeds'][fi],'domain':domain,'range_label':label}
                result,cached=run_job(key,request_case(tables,'Si-final',substrate,fi,60,meta['seed'],[190,900],domain,True),meta)
                unique.add(key)
                records.append({'key':key,'label':label,'candidate':substrate,'film':film['id'],'cached':cached,'errors':result['errors'],'uncertainty':result['uncertainty'],'statistics':result['statistics'],'elapsedMs':result['elapsedMs'],'flags':result['flags']})
                save('progress',{'stage':4,'completed':len(records),'total':26,'latest':key},replace=True)
    for r in records:
        baseline=next(a for a in records if a['candidate']==r['candidate'] and a['film']==r['film'] and a['label']=='A')
        def thick_std(row):
            return next((p['stdError'] for p in row['statistics']['parameters'] if p['id']=='thickness'),None)
        a,b=thick_std(r),thick_std(baseline)
        r['thickness_stdError']=a
        r['thickness_stdError_relative_A']=a/b if a is not None and b is not None and b>0 else None
        r['curve_sigma_relative_A']=[{c:r['uncertainty'][i][c]['rms']/baseline['uncertainty'][i][c]['rms'] if r['uncertainty'][i][c] and baseline['uncertainty'][i][c] and baseline['uncertainty'][i][c]['rms']>0 else None for c in ['n','k']} for i in range(len(r['uncertainty']))]
    automatic=[]
    for index,case in enumerate(S['automatic']):
        key='auto-'+str(index)
        req=request_case(tables,case['truth'],case['candidate'],1,60,case['seed'],case['range'])
        req['task']='auto'
        result,cached=run_job(key,req,case)
        fit=result['output']['fittingResult'];model=fit['freeFormModel']
        layer=model['layers'][model['primaryLayerIndex']]
        actual={'count':layer['parameters']['_knotCount']['current'],'lambdaN':model['lambdaN'],'lambdaK':model['lambdaK']}
        automatic.append({'key':key,'case':case,'elapsedMs':result['elapsedMs'],'errors':result['errors'],'refinement':fit['freeFormRefinement'],'origin':fit['freeFormOrigin'],'actual_model_setting':actual})
        save('progress',{'stage':4,'completed':24+len(automatic),'total':26,'latest':key},replace=True)
    assert len(records)==24 and len(unique)==20 and len(automatic)==2
    save('stage4',{'elapsed_seconds':time.monotonic()-started,'records':records,'unique_local_fits':len(unique),'logical_local_cells':24,'automatic':automatic})


def main():
    stage = sys.argv[1]
    guard()
    pause = QA / 'stage4_9b-v2-paused.json'
    if pause.exists() and not (QA / (PREFIX+'resumed.json')).exists():
        save('resumed', {'pause_record_sha256': sha(pause), 'settings_sha256': read('frozen')['settings_sha256'],
                         'resumed_at': time.time(), 'pause_caused_rerun_scope': 'none; all saved results retained; stage0 not rerun'})
    if (QA/(PREFIX+'stage'+stage+'.json')).exists():
        print('saved stage; no rerun'); return
    try:
        tables = Tables()
        globals()['stage'+stage](tables)
        guard()
        output = read('stage'+stage)
        print(json.dumps({'stage':stage,'elapsed_seconds':output['elapsed_seconds'],'complete':True}))
    except RequestedPause as error:
        save('worker-paused',{'stage':stage,'reason':str(error),'time':time.time(),'saved_fits_rerun':0},replace=True)
        print('paused after checkpoint; no worker killed')
    except Exception as error:
        save('stopped', {'stage':stage,'reason':str(error),'time':time.time(),'saved_fits_rerun':0},replace=True)
        raise


if __name__ == '__main__':
    main()
