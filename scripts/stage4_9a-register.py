"""Offline stage 0b registration; never imports or reads the application's Si table."""
import hashlib
import html
import importlib.metadata as metadata
import itertools
import json
import re
import time
from pathlib import Path

import numpy as np
import yaml
from scipy.interpolate import interp1d

ROOT = Path(__file__).resolve().parents[1]
PREFIX = ROOT / '.qa' / 'stage4_9a-'
NAMES = ['Aspnes', 'Green-1995', 'Green-2008', 'Jellison', 'Schinke',
         'Chandler-Horowitz', 'Edwards', 'Daub', 'Salzberg', 'Franta-20C',
         'Franta-25C', 'Li-293K', 'Vuye-20C', 'Sik-25C']
PRIORITY = ['Aspnes', 'Green-2008', 'Jellison', 'Chandler-Horowitz',
            'Schinke', 'Franta-25C', 'Franta-20C']
BANDS = [('190–250', 190, 250, False), ('250–400', 250, 400, False),
         ('400–900', 400, 900, True)]


def sha(value):
    return hashlib.sha256(value).hexdigest()


def save(name, obj):
    path = Path(str(PREFIX) + name + '.json')
    text = json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    with path.open('x', encoding='utf-8') as stream:
        stream.write(text)
    return sha(text.encode())


def overlap_max(left, right, component, lo, hi, closed):
    a, b = left[component], right[component]
    if a is None or b is None:
        return None
    start = int(np.ceil(max(lo, a['range'][0], b['range'][0])))
    end = min(hi if closed else hi - 1, int(np.floor(min(a['range'][1], b['range'][1]))))
    if end < start:
        return None
    if a['kind'] != 'table' or b['kind'] != 'table':
        raise RuntimeError('An analytic formula unexpectedly overlaps the 0b bands; stop, do not approximate it')
    wavelengths = np.arange(start, end + 1, dtype=float)
    values_a = interp1d(a['x'], a['y'], kind='linear', bounds_error=True)(wavelengths)
    values_b = interp1d(b['x'], b['y'], kind='linear', bounds_error=True)(wavelengths)
    difference = np.abs(values_a - values_b)
    index = int(np.argmax(difference))
    return {'max_abs': float(difference[index]), 'wavelength_nm': float(wavelengths[index]),
            'points': len(wavelengths), 'valid_grid_nm': [start, end]}


def main():
    started = time.perf_counter()
    package = metadata.distribution('pyElli')
    database = Path(package.locate_file('elli/database/refractiveindexinfo-database'))
    method = {
        'phase': '0b only; no application-Si comparison and no fitting',
        'candidates': NAMES, 'stage3_priority': PRIORITY,
        'excluded': ['Franta (amorphous)', 'Pierce', 'other temperatures', 'nonlinear n2', 'Shkondin'],
        'reference_pairwise_grid': 'integer wavelengths, 1 nm, component-specific native overlap only',
        'bands': '[190,250), [250,400), [400,900] nm; no duplicated boundary samples',
        'interpolation': 'scipy interp1d linear n or k versus wavelength; same default kind as pyElli Table; bounds_error=True',
        'missing_components': 'absent k or n is NA, never imputed as zero',
        'units': 'database wavelength micrometers multiplied by 1000 to nm; n/k dimensionless',
        'maxima': 'max absolute n difference and k difference independently; exact ties retain first pair/native-grid wavelength',
        'meaning': 'reference-table spread scale only; not a statistical confidence bound or application error',
        'experimental_settings': 'not frozen here; wait for user confirmation before stage1/settings.json/SHA256',
        'stage3_full_range_rule': 'first at most4 priority entries covering complete190–900; if fewer3 use maximal common valid range, no extrapolation',
        'stage2_dense_rule': 'first full190–900 discrete table in priority; otherwise widest discrete-table range; no extrapolation',
    }
    method_sha = save('0b-method', method)
    refs, rows = {}, []
    for name in NAMES:
        path = database / 'database/data/main/Si/nk' / (name + '.yml')
        raw = path.read_bytes()
        document = yaml.safe_load(raw.decode('utf-8-sig'))
        components = {'n': None, 'k': None}
        blocks = []
        for block in document['DATA']:
            kind = block['type']
            if kind.startswith('tabulated '):
                array = np.asarray([[float(v) for v in line.split()]
                                    for line in block['data'].splitlines() if line.strip()])
                x = array[:, 0] * 1000
                assert np.all(np.isfinite(array)) and np.all(np.diff(x) > 0)
                components_here = ['n', 'k'] if kind == 'tabulated nk' else [kind.split()[1]]
                for column, component in enumerate(components_here, 1):
                    data = {'kind': 'table', 'range': [float(x[0]), float(x[-1])],
                            'points': len(x), 'x': x, 'y': array[:, column]}
                    assert components[component] is None
                    components[component] = data
                    assert np.array_equal(interp1d(x, data['y'], kind='linear', bounds_error=True)(x), data['y'])
                blocks.append({'type': kind, 'points': len(x), 'range_nm': [float(x[0]), float(x[-1])]})
            elif kind.startswith('formula '):
                lo, hi = [float(v) * 1000 for v in block['wavelength_range'].split()]
                assert components['n'] is None
                components['n'] = {'kind': kind, 'range': [lo, hi], 'points': None}
                blocks.append({'type': kind, 'points': None, 'range_nm': [lo, hi]})
            else:
                raise RuntimeError('Unknown reference data type: ' + kind)
        joint = None
        if components['n'] is not None and components['k'] is not None:
            lo = max(components['n']['range'][0], components['k']['range'][0])
            hi = min(components['n']['range'][1], components['k']['range'][1])
            if hi >= lo:
                joint = [lo, hi]
        refs[name] = components
        rows.append({'entry': name, 'source': ' '.join(html.unescape(re.sub('<[^>]+>', '', document.get('REFERENCES', ''))).split()),
                     'comments': document.get('COMMENTS', ''), 'path': str(path), 'sha256': sha(raw), 'blocks': blocks,
                     'components': {key: None if value is None else {k: v for k, v in value.items() if k not in ('x', 'y')}
                                    for key, value in components.items()}, 'joint_nk_range_nm': joint,
                     'unit_conversion': 'wavelength um *1000 ->nm; n/k dimensionless'})
    pairs = []
    maxima = []
    for label, lo, hi, closed in BANDS:
        candidates = []
        for left, right in itertools.combinations(NAMES, 2):
            record = {'band': label, 'left': left, 'right': right}
            for component in ['n', 'k']:
                record[component] = overlap_max(refs[left], refs[right], component, lo, hi, closed)
            pairs.append(record)
            candidates.append(record)
        summary = {'band': label}
        for component in ['n', 'k']:
            eligible = [row for row in candidates if row[component] is not None]
            best = max(eligible, key=lambda row: row[component]['max_abs']) if eligible else None
            summary[component] = None if best is None else {**best[component], 'pair': [best['left'], best['right']]}
        summary['available_pairs'] = {component: sum(row[component] is not None for row in candidates) for component in ['n', 'k']}
        maxima.append(summary)
    selected = [name for name in PRIORITY if next(row for row in rows if row['entry'] == name)['joint_nk_range_nm'] is not None
                and next(row for row in rows if row['entry'] == name)['joint_nk_range_nm'][0] <= 190
                and next(row for row in rows if row['entry'] == name)['joint_nk_range_nm'][1] >= 900][:4]
    common_lo = max(next(row for row in rows if row['entry'] == name)['joint_nk_range_nm'][0] for name in PRIORITY)
    common_hi = min(next(row for row in rows if row['entry'] == name)['joint_nk_range_nm'][1] for name in PRIORITY)
    dense = next((name for name in PRIORITY if name in selected and
                  all(block['type'].startswith('tabulated ') for block in next(row for row in rows if row['entry'] == name)['blocks'])), None)
    license_path = Path(package.locate_file('pyelli-' + package.version + '.dist-info/licenses/LICENSE.txt'))
    database_license = database / 'LICENSE'
    assert 'GNU GENERAL PUBLIC LICENSE' in license_path.read_text(encoding='utf-8')
    assert 'CC0 1.0 Universal' in database_license.read_text(encoding='utf-8')
    result = {'pyElli_version': package.version, 'database': str(database),
              'database_version': 'bundled snapshot in pyElli ' + package.version + '; upstream commit not supplied in wheel',
              'method_sha256': method_sha, 'registration': rows, 'reference_spread_maxima': maxima,
              'stage3_full_range': selected, 'stage3_full_count': len(selected),
              'priority_all_common_range_nm': [common_lo, common_hi] if common_lo <= common_hi else None,
              'stage3_fallback_status': 'requires confirmation: all-priority intersection is empty' if common_lo > common_hi else 'requires user confirmation before freezing',
              'stage2_dense_selection': dense,
              'licenses': [{'path': str(license_path), 'license': 'GNU GPL v3'},
                           {'path': str(database_license), 'license': 'CC0 1.0 Universal'}],
              'elapsed_seconds': time.perf_counter() - started,
              'limits': '0b only; no src read/modification, network, installation, original reference-table copying, stage1-4 or verify'}
    pair_sha = save('reference-pairwise', pairs)
    result['pairwise_results_sha256'] = pair_sha
    save('registration', result)
    print(json.dumps({'maxima': maxima, 'full_range_entries': selected, 'dense': dense,
                      'all_priority_common_range': result['priority_all_common_range_nm'],
                      'method_sha256': method_sha, 'elapsed_seconds': result['elapsed_seconds']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
