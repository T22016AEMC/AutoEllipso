"""Offline orchestration; only this venv's Python is used for Python processing."""
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import yaml
from scipy.interpolate import interp1d, CubicSpline

ROOT = Path(__file__).resolve().parents[1]
PREFIX = ROOT / '.qa' / 'stage4_9a-'
SETTINGS = json.loads(Path(str(PREFIX) + 'settings.json').read_text(encoding='utf-8'))
REGISTRATION = json.loads(Path(str(PREFIX) + 'registration.json').read_text(encoding='utf-8'))
NODE = shutil.which('node')


def read(name):
    return json.loads(Path(str(PREFIX) + name + '.json').read_text(encoding='utf-8'))


def save(name, value):
    path = Path(str(PREFIX) + name + '.json')
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(text, encoding='utf-8')
    temporary.replace(path)


def guard():
    frozen = read('frozen')
    for suffix, key in [('settings.json', 'settings_sha256'), ('frozen-report.md', 'report_sha256')]:
        assert hashlib.sha256(Path(str(PREFIX) + suffix).read_bytes()).hexdigest() == frozen[key]
    for name, digest in frozen['inputs']['src'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, 'src changed: ' + name
    for name, digest in frozen['inputs']['references'].items():
        assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest, 'reference changed: ' + name


def worker(request):
    guard()
    result_path = Path(str(PREFIX) + request['key'] + '.json')
    if result_path.exists():
        return read(request['key'])
    started = time.monotonic()
    result = subprocess.run([NODE, '--enable-source-maps', '--import', 'tsx', 'scripts/stage4_9a-worker.ts'],
                            input=json.dumps(request), text=True, encoding='utf-8', capture_output=True, cwd=ROOT)
    Path(str(PREFIX) + request['key'] + '.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('Worker failed: ' + request['key'] + '\n' + result.stderr)
    assert result_path.exists(), 'worker omitted checkpoint'
    value = read(request['key'])
    save('latest-job', {'key': request['key'], 'process_wall_seconds': time.monotonic() - started})
    return value


def load_reference(name):
    entry = next(row for row in REGISTRATION['registration'] if row['entry'] == name)
    obj = yaml.safe_load(Path(entry['path']).read_text(encoding='utf-8-sig'))
    components = {}
    for block in obj['DATA']:
        if not block['type'].startswith('tabulated '):
            continue
        array = np.asarray([[float(v) for v in line.split()] for line in block['data'].splitlines() if line.strip()])
        for index, component in enumerate(['n', 'k'] if block['type'] == 'tabulated nk' else [block['type'].split()[1]], 1):
            components[component] = (array[:, 0] * 1000, array[:, index])
    return entry, components


def evaluate(name, component, grid):
    entry, components = load_reference(name)
    result = np.full(len(grid), np.nan)
    if component not in components:
        # Formula-only entries start beyond1200nm; never invent their missing k.
        info = entry['components'][component]
        if info is not None:
            assert not np.any((grid >= info['range'][0]) & (grid <= info['range'][1])), 'analytic evaluation required: stop'
        return result
    x, y = components[component]
    valid = (grid >= x[0]) & (grid <= x[-1])
    result[valid] = interp1d(x, y, bounds_error=True, kind='linear')(grid[valid])
    return result


def region_mask(grid, band):
    lo, hi, closed = band
    return (grid >= lo) & ((grid <= hi) if closed else (grid < hi))


def error_stats(grid, errors):
    valid = np.isfinite(errors)
    if not valid.any():
        return None
    x, e = grid[valid], errors[valid]
    at = int(np.argmax(np.abs(e)))
    return {'points': len(x), 'maxAbs': float(abs(e[at])), 'at_nm': float(x[at]),
            'rms': float(np.sqrt(np.mean(e * e))), 'bias': float(np.mean(e))}


def stage1():
    started = time.monotonic()
    application = worker({'task': 'si', 'key': 'application-si'})
    grid = np.array([row['wavelength'] for row in application['curve']], dtype=float)
    own = {c: np.array([row[c] for row in application['curve']]) for c in ['n', 'k']}
    candidates = {row['entry']: {c: evaluate(row['entry'], c, grid) for c in ['n', 'k']}
                  for row in REGISTRATION['registration']}
    comparisons = []
    for name, values in candidates.items():
        records = []
        for band in SETTINGS['bands']:
            mask = region_mask(grid, band)
            records.append({'band': band, **{c: error_stats(grid[mask], (own[c] - values[c])[mask]) for c in ['n', 'k']}})
        comparisons.append({'entry': name, 'bands': records})
    envelope_points = []
    for index, wavelength in enumerate(grid):
        if wavelength > 900:
            continue
        point = {'wavelength': float(wavelength)}
        for component in ['n', 'k']:
            covered = [(name, float(values[component][index])) for name, values in candidates.items()
                       if np.isfinite(values[component][index])]
            families = {('Franta-model' if name.startswith('Franta-') else name) for name, value in covered}
            if 190 <= wavelength <= 206.6 or len(families) == 1:
                ref = candidates['Franta-25C'][component][index]
                point[component] = {'kind': 'single source(model)', 'delta': float(own[component][index] - ref)} if np.isfinite(ref) else {'kind': 'no reference'}
            elif len(families) >= 2:
                lo, hi = min(v for name, v in covered), max(v for name, v in covered)
                value = float(own[component][index])
                point[component] = {'kind': 'envelope', 'families': len(families), 'entries': len(covered),
                                    'min': lo, 'max': hi, 'inside': lo <= value <= hi,
                                    'excess': max(lo - value, value - hi, 0.0)}
            else:
                point[component] = {'kind': 'no reference'}
        envelope_points.append(point)
    envelope = []
    for band in SETTINGS['bands']:
        lo, hi, closed = band
        rows = [p for p in envelope_points if p['wavelength'] >= lo and (p['wavelength'] <= hi if closed else p['wavelength'] < hi)]
        summary = {'band': band}
        for component in ['n', 'k']:
            multiple = [p for p in rows if p[component]['kind'] == 'envelope']
            single = [p for p in rows if p[component]['kind'].startswith('single')]
            inside = sum(p[component]['inside'] for p in multiple)
            best = max(multiple, key=lambda p: p[component]['excess']) if multiple else None
            summary[component] = {'multiple_points': len(multiple), 'inside': inside, 'outside': len(multiple) - inside,
                                  'inside_fraction': inside / len(multiple) if multiple else None,
                                  'outside_fraction': (len(multiple) - inside) / len(multiple) if multiple else None,
                                  'max_excess': best[component]['excess'] if best else None,
                                  'at_nm': best['wavelength'] if best and best[component]['excess'] > 0 else None,
                                  'single_points': len(single),
                                  'single_difference': error_stats(np.array([p['wavelength'] for p in single]), np.array([p[component]['delta'] for p in single]))}
        envelope.append(summary)
    clamped = [p for p in application['curve'] if p['wavelength'] >= 1000]
    assert all(p['n'] == clamped[0]['n'] and p['k'] == clamped[0]['k'] for p in clamped)
    save('stage1', {'elapsed_seconds': time.monotonic() - started, 'comparisons': comparisons, 'envelope': envelope,
                    'envelope_points': envelope_points, 'support_190_206_6': ['Franta-20C', 'Franta-25C (same model family)'],
                    'beyond_range': {'behavior': 'constant endpoint clamp beyond1000, not a measured reference',
                                     'samples': [p for p in application['curve'] if p['wavelength'] in [900, 950, 1000, 1100, 1200]]}})


def stage2():
    started = time.monotonic()
    grid = np.array(SETTINGS['dense_grid_nm'], dtype=float)
    knots = np.array(read('application-si')['knots'], dtype=float)
    assert len(knots) == 31
    n, k = evaluate('Franta-25C', 'n', grid), evaluate('Franta-25C', 'k', grid)
    ns, ks = evaluate('Franta-25C', 'n', knots), evaluate('Franta-25C', 'k', knots)
    assert np.all(np.isfinite(ns)) and np.all(np.isfinite(ks))
    epsilon = (ns + 1j * ks) ** 2
    energy = SETTINGS['energy_constant_eVnm'] / knots
    order = np.argsort(energy)
    methods = [interp1d(knots, ns)(grid) + 1j * interp1d(knots, ks)(grid),
               np.sqrt(CubicSpline(knots, epsilon, bc_type='not-a-knot', extrapolate=False)(grid)),
               np.sqrt(CubicSpline(energy[order], epsilon[order], bc_type='not-a-knot', extrapolate=False)(SETTINGS['energy_constant_eVnm'] / grid))]
    results = []
    for name, curve in zip(SETTINGS['stage2_methods'], methods):
        assert np.all(np.isfinite(curve))
        records = []
        for band in SETTINGS['bands']:
            mask = region_mask(grid, band)
            records.append({'band': band, 'n': error_stats(grid[mask], (curve.real - n)[mask]),
                            'k': error_stats(grid[mask], (curve.imag - k)[mask])})
        results.append({'method': name, 'bands': records, 'negative_k_points': int(np.sum(curve.imag < 0)),
                        'rows': [{'wavelength': float(w), 'nError': float(a - b), 'kError': float(c - d)}
                                 for w, a, b, c, d in zip(grid, curve.real, n, curve.imag, k)]})
    save('stage2', {'elapsed_seconds': time.monotonic() - started, 'reference': 'Franta-25C (model output)',
                    'original_controls_nm': knots.tolist(), 'results': results})


def stage3():
    started = time.monotonic()
    jobs = []
    for ref_index, ref in enumerate(SETTINGS['substrates']):
        grid = np.arange(ref['lo'], ref['hi'] + 1, 10, dtype=float)
        ns, ks = evaluate(ref['id'], 'n', grid), evaluate(ref['id'], 'k', grid)
        assert np.all(np.isfinite(ns)) and np.all(np.isfinite(ks))
        for film_index, film in enumerate(SETTINGS['films']):
            for thickness_index, thickness in enumerate(SETTINGS['thicknesses_nm']):
                key = f"stage3-{ref['id']}-{film['id']}-{thickness}"
                request = {'task': 'local', 'key': key, 'reference': ref['id'], 'range': [ref['lo'], ref['hi']],
                           'modelOutput': ref['model_output'], 'film': film_index, 'thickness': thickness,
                           'seed': 59001 + 100 * ref_index + 10 * film_index + thickness_index,
                           'si': [{'wavelength': float(w), 'n': float(n), 'k': float(k)} for w, n, k in zip(grid, ns, ks)]}
                result = worker(request)
                jobs.append({'key': key, 'meta': result['meta'], 'elapsedMs': result['elapsedMs'], 'forward': result['forward'],
                             'errors': {k: v for k, v in result['errors'].items() if k != 'rows'},
                             'status': result['result']['status'], 'converged': result['result']['converged']})
                if film_index == 1 and thickness == 60:
                    auto = worker({**request, 'task': 'auto', 'key': key + '-automatic', 'localKey': key})
                    jobs.append({'key': key + '-automatic', 'meta': auto['meta'], 'elapsedMs': auto['elapsedMs'],
                                 'errors': {k: v for k, v in auto['errors'].items() if k != 'rows'},
                                 'freeForm': auto['output']['fittingResult']['freeFormRefinement']})
                save('progress', {'stage': 3, 'completed': len(jobs), 'total': 35, 'latest': key,
                                  'elapsed_seconds': time.monotonic() - started})
    assert len(jobs) == 35
    save('stage3', {'jobs': jobs, 'elapsed_seconds': time.monotonic() - started,
                    'local_fits': 30, 'automatic_fits': 5, 'saved_results_rerun': 0})


def stage4():
    started = time.monotonic()
    counters = []
    for truth in ['V1', 'V3', 'V6']:
        result = worker({'task': 'counter', 'key': 'counter-' + truth, 'id': truth})
        counters.append({k: v for k, v in result.items() if k != 'output'})
        save('progress', {'stage': 4, 'completed': len(counters), 'total': 3, 'latest': truth,
                          'elapsed_seconds': time.monotonic() - started})
    inventory = worker({'task': 'static', 'key': 'bspline-call-inventory'})
    parts, sources = [], []
    for name in SETTINGS['stage4_bundle']:
        raw = (ROOT / name).read_bytes()
        contents = raw.decode('utf-8')
        parts.append('===== ' + name + ' =====\n' + contents + ('\n' if not contents.endswith('\n') else '') + '\n')
        sources.append({'path': name, 'lines': len(contents.splitlines()), 'sha256': hashlib.sha256(raw).hexdigest()})
    bundle = ROOT / '.qa/audit-bundle-2.txt'
    with bundle.open('w', encoding='utf-8', newline='') as stream:
        stream.write(''.join(parts))
    save('audit-bundle-manifest', {'files': sources, 'over1500': [p for p in sources if p['lines'] > 1500],
                                  'bundle': str(bundle), 'sha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
                                  'desktop_destination': str(Path.home() / 'Desktop/audit-bundle-2.txt')})
    save('stage4', {'elapsed_seconds': time.monotonic() - started, 'counters': counters,
                    'static_call_count': len(inventory['calls']), 'bundle': str(bundle), 'desktop_copy': 'pending'})


def main():
    assert Path(sys.executable).resolve() == Path(SETTINGS['python']).resolve()
    stage = sys.argv[1]
    guard()
    if Path(str(PREFIX) + 'stage' + stage + '.json').exists():
        print(json.dumps({'stage': stage, 'status': 'saved; not rerun'}, ensure_ascii=True))
        return
    try:
        {'1': stage1, '2': stage2, '3': stage3, '4': stage4}[stage]()
        guard()
        result = read('stage' + stage)
        print(json.dumps({'stage': stage, 'elapsed_seconds': result['elapsed_seconds'], 'status': 'complete'}, ensure_ascii=True))
    except Exception as error:
        save('stopped', {'stage': stage, 'error': str(error), 'time': time.time(),
                         'saved_results_rerun': 0, 'remaining_scope': 'resume only unsaved job after cause is assessed'})
        raise


if __name__ == '__main__':
    main()
