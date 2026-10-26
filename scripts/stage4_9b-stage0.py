"""Frozen, offline native-table registration and interpolation stopping check."""
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from scipy.interpolate import PchipInterpolator, interp1d

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.qa'


def read(name):
    return json.loads((QA / ('stage4_9b-' + name + '.json')).read_text(encoding='utf-8'))


def save(name, value):
    target = QA / ('stage4_9b-' + name + '.json')
    assert not target.exists(), 'saved checkpoint must not be rerun: ' + name
    temporary = target.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8', newline='')
    temporary.replace(target)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def guard():
    frozen, settings = read('frozen'), read('settings')
    assert Path(sys.executable).resolve() == Path(settings['python']).resolve()
    assert digest(QA / 'stage4_9b-settings.json') == frozen['settings_sha256']
    assert digest(QA / 'stage4_9b-frozen-report.md') == frozen['report_sha256']
    assert digest(Path(settings['si_final']['path'])) == frozen['si_final_sha256']
    assert digest(QA / 'stage4_9a-pchip-reference-check.json') == frozen['prior_pchip_sha256']
    assert digest(QA / 'stage4_9a-registration.json') == frozen['registration_sha256']
    for path, expected in frozen['references'].items():
        assert digest(Path(path)) == expected, 'reference changed: ' + path
    for path, expected in frozen['src'].items():
        assert digest(ROOT / path) == expected, 'production source changed: ' + path
    return settings


def error_summary(energy, error):
    index = int(np.argmax(np.abs(error)))
    return {'maxAbs': float(abs(error[index])), 'at_eV': float(energy[index]),
            'at_nm': float(1239.841984 / energy[index]), 'rms': float(np.sqrt(np.mean(error ** 2)))}


def nk(epsilon):
    assert np.isfinite(epsilon).all() and np.all(epsilon[:, 1] >= 0), 'invalid epsilon, no silent correction'
    magnitude = np.hypot(epsilon[:, 0], epsilon[:, 1])
    return np.column_stack([np.sqrt((magnitude + epsilon[:, 0]) / 2), np.sqrt((magnitude - epsilon[:, 0]) / 2)])


def main():
    started = time.monotonic()
    settings = guard()
    if (QA / 'stage4_9b-stage0.json').exists():
        print('stage0 already saved; not rerun')
        return
    original = Path(settings['si_final']['path'])
    text = original.read_text(encoding='utf-8-sig')
    lines = text.splitlines()
    assert 'Herzinger' in lines[0] and lines[1].strip() == 'eV' and lines[2].strip() == 'e1e2'
    native = np.array([[float(v) for v in line.split()] for line in lines[3:] if line.strip()])
    assert native.ndim == 2 and native.shape[1] == 3 and np.isfinite(native).all()
    assert np.all(np.diff(native[:, 0]) < 0), 'expected strictly descending native energy'
    descending = native
    runs, start = [], 0
    for end in range(1, len(descending)):
        if descending[end, 2] > descending[end - 1, 2]:
            if end - start > 1 and descending[end - 1, 2] == 0:
                runs.append({'from_eV': float(descending[start, 0]), 'to_eV': float(descending[end - 1, 0]), 'rows': end - start})
            start = end
    if len(descending) - start > 1 and descending[-1, 2] == 0:
        runs.append({'from_eV': float(descending[start, 0]), 'to_eV': float(descending[-1, 0]), 'rows': len(descending) - start})
    steps = np.round(-np.diff(descending[:, 0]), 10)
    step_groups = [{'step_eV': float(step), 'intervals': int(np.sum(steps == step)),
                    'interval_energy_extent': [float(np.min(descending[1:, 0][steps == step])), float(np.max(descending[:-1, 0][steps == step]))]}
                   for step in np.unique(steps)]
    below = descending[descending[:, 0] < 1]
    registration = {'path': str(original), 'bytes': original.stat().st_size, 'sha256': digest(original),
                    'header': lines[:3], 'rows': len(native), 'energy_range_eV': [float(native[-1, 0]), float(native[0, 0])],
                    'wavelength_range_nm': [settings['hc_eVnm'] / float(native[0, 0]), settings['hc_eVnm'] / float(native[-1, 0])],
                    'steps': step_groups, 'native_nonincreasing_runs_ending_at_zero': runs,
                    'below1eV_native_rows': len(below), 'below1eV_native_nonzero_epsilon2': int(np.sum(below[:, 2] != 0)),
                    'below1eV_policy': 'force epsilon2=0 in memory only', 'paper_range_eV': [.75, 6.5],
                    'model_extrapolation_below_nm': settings['hc_eVnm'] / 6.5}
    save('registration', registration)
    ascending = native[::-1].copy()
    ascending[ascending[:, 0] < 1, 2] = 0
    energy, epsilon = ascending[:, 0], ascending[:, 1:]
    linear = interp1d(energy, epsilon, axis=0, bounds_error=True)
    pchip = PchipInterpolator(energy, epsilon, axis=0, extrapolate=False)

    def evaluate(interpolator, queries):
        assert np.min(queries) >= energy[0] and np.max(queries) <= energy[-1], 'outside native input domain'
        values = np.asarray(interpolator(queries)).copy()
        values[queries < 1, 1] = 0
        assert np.isfinite(values).all()
        return values

    # Both interpolants must reproduce controls, including the stipulated zero tail.
    assert np.max(np.abs(evaluate(linear, energy) - epsilon)) < 1e-12
    assert np.max(np.abs(evaluate(pchip, energy) - epsilon)) < 1e-12
    query = np.unique(np.concatenate([np.linspace(a, b, 101) for a, b in zip(energy[:-1], energy[1:])]))
    diff = evaluate(linear, query) - evaluate(pchip, query)
    epsilon_comparison = {'grid': '100 subdivisions per native energy interval', 'points': len(query),
                          'epsilon1': error_summary(query, diff[:, 0]), 'epsilon2': error_summary(query, diff[:, 1]),
                          'measured': {}, 'extrapolated': {}}
    for name, mask in [('measured', (query >= .75) & (query <= 6.5)), ('extrapolated', query > 6.5)]:
        epsilon_comparison[name] = {f'epsilon{i+1}': error_summary(query[mask], diff[mask, i]) for i in [0, 1]} if mask.any() else None
    save('native-epsilon-interpolation', epsilon_comparison)
    wavelengths = np.array(settings['stage0_forward_gate']['wavelengths_nm'], dtype=float)
    query_energy = settings['hc_eVnm'] / wavelengths
    a, b = nk(evaluate(linear, query_energy)), nk(evaluate(pchip, query_energy))
    points = [{'wavelength': float(w), 'linear': {'n': float(x[0]), 'k': float(x[1])},
               'pchip': {'n': float(y[0]), 'k': float(y[1])}} for w, x, y in zip(wavelengths, a, b)]
    result = subprocess.run([shutil.which('node'), '--import', 'tsx', 'scripts/stage4_9b-forward.ts'],
                            input=json.dumps({'points': points}), capture_output=True, text=True, encoding='utf-8', cwd=ROOT)
    assert result.returncode == 0, 'forward worker failed: ' + result.stderr
    forward = json.loads(result.stdout)
    save('native-forward-interpolation', forward)
    maximum = max(forward['global'][c]['maxAbs'] for c in ['psi', 'delta'])
    stopped = maximum >= settings['stage0_forward_gate']['stop_at_or_above_degrees']
    guard()
    output = {'elapsed_seconds': time.monotonic() - started, 'stopped': stopped,
              'reason': 'native interpolation forward difference>=0.003deg' if stopped else 'gate passed',
              'forward_max_degrees': maximum, 'threshold_degrees': .003,
              'completed': {'stage0': 1, 'stage1': 0, 'stage2': 0, 'stage3': 0, 'stage4': 0, 'verify': 0},
              'saved_results_rerun': 0, 'rerun_scope': 'none', 'settings_changed_after_freeze': False}
    save('stage0', output)
    if stopped:
        save('stopped', output)
    print(json.dumps(output, ensure_ascii=True))


if __name__ == '__main__':
    main()
