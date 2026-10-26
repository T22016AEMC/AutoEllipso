"""Authorized pre-freeze C.1: reference pairs only, offline."""
import importlib.metadata as metadata
import json
from pathlib import Path
import numpy as np
import yaml
from scipy.interpolate import interp1d, PchipInterpolator

NAMES = ['Aspnes', 'Green-1995', 'Green-2008', 'Jellison', 'Schinke',
         'Chandler-Horowitz', 'Edwards', 'Daub', 'Salzberg', 'Franta-20C',
         'Franta-25C', 'Li-293K', 'Vuye-20C', 'Sik-25C']
BASE = Path(metadata.distribution('pyElli').locate_file(
    'elli/database/refractiveindexinfo-database/database/data/main/Si/nk'))


def read(name):
    document = yaml.safe_load((BASE / (name + '.yml')).read_text(encoding='utf-8-sig'))
    out = {}
    for block in document['DATA']:
        if not block['type'].startswith('tabulated '):
            continue
        data = np.array([[float(v) for v in line.split()] for line in block['data'].splitlines() if line.strip()])
        x = data[:, 0] * 1000
        for index, component in enumerate(['n', 'k'] if block['type'] == 'tabulated nk' else [block['type'].split()[1]], 1):
            out[component] = (x, data[:, index])
    return out


def main():
    rows = []
    for i, j in [(1, 13), (2, 13), (1, 4), (4, 5), (1, 2)]:
        a, b = read(NAMES[i - 1]), read(NAMES[j - 1])
        row = {'pair': [i, j], 'entries': [NAMES[i - 1], NAMES[j - 1]]}
        for component in ['n', 'k']:
            x, y = a[component]
            xx, yy = b[component]
            lo = max(250, int(np.ceil(x[0])), int(np.ceil(xx[0])))
            hi = min(399, int(np.floor(x[-1])), int(np.floor(xx[-1])))
            grid = np.arange(lo, hi + 1)
            values = {}
            for kind in ['linear', 'pchip']:
                f = interp1d(x, y, bounds_error=True) if kind == 'linear' else PchipInterpolator(x, y, extrapolate=False)
                g = interp1d(xx, yy, bounds_error=True) if kind == 'linear' else PchipInterpolator(xx, yy, extrapolate=False)
                diff = np.abs(f(grid) - g(grid))
                index = int(np.argmax(diff))
                values[kind] = {'max_abs': float(diff[index]), 'wavelength_nm': int(grid[index])}
            values['pchip_minus_linear_max'] = values['pchip']['max_abs'] - values['linear']['max_abs']
            row[component] = values
        rows.append(row)
    path = Path('.qa/stage4_9a-pchip-reference-check.json')
    with path.open('x', encoding='utf-8') as stream:
        json.dump({'band': '[250,400) nm', 'grid_nm': 1, 'pairs': rows,
                   'scope': 'reference-only; before experimental freeze; no application Si table'},
                  stream, ensure_ascii=False, indent=2)
    print(json.dumps(rows, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
