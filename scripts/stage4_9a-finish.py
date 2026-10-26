"""One-shot verification and compact reporting of already checkpointed audit results."""
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.qa'
PREFIX = 'stage4_9a-'


def read(name):
    return json.loads((QA / (PREFIX + name + '.json')).read_text(encoding='utf-8'))


def save(name, value):
    target = QA / (PREFIX + name + '.json')
    temporary = target.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)


def guard():
    spec = importlib.util.spec_from_file_location('audit_run', ROOT / 'scripts/stage4_9a-run.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert Path(sys.executable).resolve() == Path(module.SETTINGS['python']).resolve()
    module.guard()


def verify():
    guard()
    read('stage4')
    marker = QA / (PREFIX + 'verify-start.json')
    with marker.open('x', encoding='utf-8') as stream:
        json.dump({'started': time.time(), 'command': 'pnpm run verify', 'runs': 1}, stream)
    started = time.monotonic()
    with (QA / (PREFIX + 'verify.log')).open('w', encoding='utf-8') as stream:
        result = subprocess.run([shutil.which('pnpm.cmd'), 'run', 'verify'], cwd=ROOT,
                                stdout=stream, stderr=subprocess.STDOUT, text=True)
    names = ['verification-summary.json', 'v2-original-tests.json', 'scientific-tests.json', 'worker-tests.json']
    for name in names:
        assert (QA / name).stat().st_mtime >= json.loads(marker.read_text(encoding='utf-8'))['started'], 'stale verify artifact: ' + name
        shutil.copyfile(QA / name, QA / (PREFIX + name))
    suites = {}
    for name in names[1:]:
        rows = json.loads((QA / name).read_text(encoding='utf-8'))
        suites[name] = {'passed': sum(r['passed'] for r in rows), 'total': len(rows),
                        'failures': [r for r in rows if not r['passed']]}
    old = json.loads((QA / 'stage4_8c-scientific-tests.json').read_text(encoding='utf-8'))
    expected = [r for r in old if not r['passed']]
    actual = suites['scientific-tests.json']['failures']
    save('verify', {'elapsed_seconds': time.monotonic() - started, 'exit_code': result.returncode,
                    'suites': suites, 'scientific_failures_exactly_unchanged': actual == expected,
                    'expected_failures': expected,
                    'commands': json.loads((QA / 'verification-summary.json').read_text(encoding='utf-8'))['commands']})
    guard()
    print(json.dumps(read('verify'), ensure_ascii=True))


def desktop():
    guard()
    manifest = read('audit-bundle-manifest')
    source = Path(manifest['bundle'])
    destination = Path(manifest['desktop_destination'])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest['sha256']
    if destination.exists():
        assert hashlib.sha256(destination.read_bytes()).hexdigest() == manifest['sha256'], 'existing Desktop bundle differs; not overwritten'
    else:
        shutil.copyfile(source, destination)
    assert hashlib.sha256(destination.read_bytes()).hexdigest() == manifest['sha256']
    save('desktop-copy', {'path': str(destination), 'sha256': manifest['sha256'], 'matches': True})
    result = read('stage4')
    result['desktop_copy'] = 'complete; identical SHA256'
    save('stage4', result)
    print(json.dumps({'desktop_copy': 'complete', 'sha256': manifest['sha256']}))


def number(value):
    return 'NA' if value is None else f'{value:.4g}'


def stat(value, location=False):
    if value is None:
        return 'NA'
    return number(value['maxAbs']) + (('@' + number(value['at_nm'])) if location else '') + '/' + number(value['rms'])


def film_errors(errors):
    return '; '.join(stat(r['nError']) + ',' + stat(r['kError']) for r in errors['regions'])


def flags(job):
    f = ''.join(str(i + 1) for i, r in enumerate(job.get('forward', []))
                if r['points'] and max(r['psiError']['maxAbs'], r['deltaError']['maxAbs']) > .03)
    n = ''.join(str(i + 1) for i, r in enumerate(job['errors']['regions'])
                if r['nError'] is not None and r['nError']['maxAbs'] > .01)
    d = abs(job['errors']['thicknessError']) > .1
    return f'F:{f or "—"},n:{n or "—"},d:{int(d)}'


def report():
    guard()
    assert read('desktop-copy')['matches']
    verification_start = read('verify-start')['started']
    for name in ['verification-summary.json', 'v2-original-tests.json', 'scientific-tests.json', 'worker-tests.json']:
        assert (QA / name).stat().st_mtime >= verification_start, 'stale verify artifact: ' + name
        assert (QA / name).read_bytes() == (QA / (PREFIX + name)).read_bytes(), 'verify archive changed: ' + name
    a, b, c, d, v = [read(n) for n in ['stage1', 'stage2', 'stage3', 'stage4', 'verify']]
    reg = read('registration')
    source_catalog = '；'.join(row['entry'] + '(' + ','.join(dict.fromkeys(re.findall(r'\b(?:19|20)\d{2}\b', row['source']))) + ')' for row in reg['registration'])
    lines = [
        '# Stage 4.9a：Si 基板稽核', '',
        '基準895dec2／v2.2-integration；src、容差、迭代上限、既有斷言、部署設定均未修改；只離線讀指定venv／pyElli 0.23.1。',
        '設定SHA256：`' + read('frozen')['settings_sha256'] + '`；凍結原稿`.qa/stage4_9a-frozen-report.md`。',
        '14來源原檔SHA／來源論文／型態／點數／分量範圍見`.qa/stage4_9a-registration.json`；資料庫為套件內建快照，上游commit無法判定；未複製文獻原表進專案。',
        '來源及年份（照原資料庫引文）：' + source_catalog + '。',
        '設計：波段①[190,250)、②[250,400)、③[400,900]nm；參考n/k各自有效域內波長線性內插，缺分量／範圍記NA、不外推。',
        '3a/3b：Cauchy(A1.72,B.0031,C.00004,k0=0)及Gaussian(ε∞2.7,A1.7,E0=3.6,σ.5)，d20/60/100，AOI65/70/75，σ=.03°，種子59001+100r+10f+d；完整參數／索引見settings。',
        '3b真值起點直接正式LM50次／ftol1e-5／既有xtol/gtol；透明k0、關閉振子固定；3c完整Automatic Gaussian60共5次，共用對應3b資料。',
        '固定3a標記F：任一角度maxAbs Ψ或圓周Δ差>.03°；n：maxAbs n誤差>.01；d：abs厚度差>.1nm；僅標記，不作好壞判定。',
        '3使用範圍：Franta-25C190–900（模型輸出非原始量測）、Aspnes210–820、Jellison240–840、Green-2008／Schinke250–900；各自10nm。',
        'C.1凍結前僅比較參考彼此：250–400的5對linear/PCHIP最大差及位置見`.qa/stage4_9a-pchip-reference-check.json`；未據此改來源、規則或門檻。', '',
        '階段1：各來源Δn、Δk的「最大絕對值@nm/RMS」；每欄依序①；②；③。', '',
        '|來源|Δn：①；②；③|Δk：①；②；③|', '|---|---|---|'
    ]
    for row in a['comparisons']:
        lines.append('|' + row['entry'] + '|' + '; '.join(stat(r['n'], True) for r in row['bands']) + '|' + '; '.join(stat(r['k'], True) for r in row['bands']) + '|')
    lines += ['', '參考表彼此的線性內插最大差n/k@nm（僅作來源間差異尺度）：' + '；'.join(row['band'] + ':' + '/'.join(number(row[c]['max_abs']) + '@' + number(row[c]['wavelength_nm']) for c in ['n', 'k']) for row in reg['reference_spread_maxima']) + '；配對與涵蓋範圍見reference-pairwise.json。', '', '包絡只計≥2來源族（Franta兩溫度計同族）；欄為內/外比例、超出最大值@nm；①另有17個單一模型波長不計比例。', '',
              '|波段|n內%/外%；超出|k內%/外%；超出|', '|---|---|---|']
    for row in a['envelope']:
        cells = []
        for component in ['n', 'k']:
            s = row[component]
            cells.append(number(100 * s['inside_fraction']) + '/' + number(100 * s['outside_fraction']) + ';' + number(s['max_excess']) + '@' + number(s['at_nm']))
        lines.append('|' + str(row['band'][:2]) + '|' + '|'.join(cells) + '|')
    single = a['envelope'][0]
    lines += ['', '190–206.6只由Franta模型族支持：單一來源（模型），與Franta25C差n ' + stat(single['n']['single_difference'], True) + '、k ' + stat(single['k']['single_difference'], True) + '；我們的表正確或錯誤：無法判定。',
              '現有Si表31點、190–1000nm；900–1000仍內插，1000–1200固定端點夾值；與宣稱1200及tabulated下限250不一致，原始行為見stage1.json。', '',
              '階段2：Franta25C模型190–900/1nm；只量化31點取樣後重建誤差，不含表值差異；三次均not-a-knot；欄為max/RMS（n,k）。', '',
              '|內插|① n,k|② n,k|③ n,k|負k點數|', '|---|---|---|---|---|']
    for label, row in zip(['n/k–λ線性', 'ε–λ三次', 'ε–E三次'], b['results']):
        lines.append('|' + label + '|' + '|'.join(stat(r['n']) + ',' + stat(r['k']) for r in row['bands']) + '|' + str(row['negative_k_points']) + '|')
    lines += ['', '階段3a/3b：各列基板沿用上列範圍；F為各段maxAbs Ψ/Δ度；誤差為各段n max/RMS,k max/RMS；厚差為有號nm。完整位置、偏差均值、RMS與逐點資料見`.qa/stage4_9a-stage3-*.json`。', '',
              '|基板/膜/真厚|F①；②；③|n,k誤差①；②；③|厚差|LM狀態|標記波段|', '|---|---|---|---|---|---|']
    local_jobs = [j for j in c['jobs'] if 'forward' in j]
    for j in local_jobs:
        meta = j['meta']
        forward = '; '.join('NA' if not r['points'] else number(r['psiError']['maxAbs']) + '/' + number(r['deltaError']['maxAbs']) for r in j['forward'])
        lines.append('|' + '/'.join([meta['reference'], meta['film'], str(meta['thickness'])]) + '|' + forward + '|' + film_errors(j['errors']) + '|' + number(j['errors']['thicknessError']) + '|' + j['status'] + '/' + str(j['converged']) + '|' + flags(j) + '|')
    lines += ['', '階段3c：完整Automatic的最終自由形式（非物理終點厚度）；各段誤差同上；未收斂狀態照錄。', '',
              '|基板Gaussian60|n,k誤差①；②；③|厚差|選中來源/設定/狀態|標記|秒|', '|---|---|---|---|---|---|']
    auto_jobs = [j for j in c['jobs'] if 'forward' not in j]
    for j in auto_jobs:
        full = read(j['key'])['output']['fittingResult']
        refinement = full.get('freeFormRefinement') or {}
        selected = refinement.get('selectedSetting') or {}
        selected_step = next((step for step in (refinement.get('ladderV2') or {}).get('steps', []) if step['count'] == selected.get('count') and step['scale'] == selected.get('scale')), {})
        status = str(selected_step.get('status', 'NA')) + '/' + str(selected_step.get('converged', 'NA'))
        lines.append('|' + j['meta']['reference'] + '|' + film_errors(j['errors']) + '|' + number(j['errors']['thicknessError']) + '|' + str(full.get('freeFormOrigin')) + '/' + str(selected) + '/' + status + '|' + flags(j).split(',', 1)[1] + '|' + number(j['elapsedMs'] / 1000) + '|')
    lines += ['', '階段4 S3：記憶體建構子插樁；NaN/Infinity控制1次、2分量均偵測後清零；磁碟src未動。', '',
              '|案例49001|非有限建構子/實部/虛部|與4.8c最大數值差|秒|', '|---|---|---|---|']
    for row in d['counters']:
        lines.append('|' + row['id'] + '|' + '/'.join(str(row[k]) for k in ['constructors', 'realComponents', 'imaginaryComponents']) + '|' + number(row['difference']) + '|' + number(row['elapsedMs'] / 1000) + '|')
    inventory = read('bspline-call-inventory')
    bundle = read('audit-bundle-manifest')
    lines += ['', 'S3位置／逐次彙總見`.qa/stage4_9a-counter-V{1,3,6}.json`；零次僅限本3案例，不能推論所有輸入。',
              f"S4 AST清單{len(inventory['calls'])}處（含保守列入的條件派送），路徑/行/參數/節點欄位見`.qa/stage4_9a-bspline-call-inventory.json`；動態傳遞無法靜態判定者明記無法判定，不宣稱缺失。",
              'S9完整16檔無刪減：`.qa/audit-bundle-2.txt`及桌面`audit-bundle-2.txt`；逐檔SHA／行數見`.qa/stage4_9a-audit-bundle-manifest.json`；桌面複本另校驗一致。',
              '超過1500行：' + '；'.join(row['path'] + ':' + str(row['lines']) for row in bundle['over1500']) + '，均保留全文。',
              'verify僅1次：' + '；'.join(name + ' ' + str(s['passed']) + '/' + str(s['total']) for name, s in v['suites'].items()) + '；typecheck/build結果見verify.json。',
              'scientific兩項失敗名稱與完整內容對4.8c：' + ('逐字相同，無新增。' if v['scientific_failures_exactly_unchanged'] else '有差異，見verify.json，必須單獨回報。'),
              '既有失敗：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance；Stage4.1: SiO2 regression and timing against Stage3/4 baseline。',
              '耗時秒：0b ' + number(reg['elapsed_seconds']) + '（C.1未獨立計時，無法判定）、1 ' + number(a['elapsed_seconds']) + '、2 ' + number(b['elapsed_seconds']) + '、3 ' + number(c['elapsed_seconds']) + '（30局部+5Automatic）、4 ' + number(d['elapsed_seconds']) + '、verify ' + number(v['elapsed_seconds']) + '；已計時作業合計 ' + number(sum(x['elapsed_seconds'] for x in [reg,a,b,c,d,v])) + '；逐資料集毫秒見stage3.json。',
              '執行記錄：凍結校驗先擋下CRLF/LF序列化差異，僅標準化換行並留備份；任何階段1資料前修復，設計文字未改。靜態AST改用既有Rolldown解析器；已保存擬合重算0。',
              '標記總數：3a前向超標 ' + str(sum(any(r['points'] and max(r['psiError']['maxAbs'], r['deltaError']['maxAbs']) > .03 for r in j['forward']) for j in local_jobs)) + '/30組；3b膜n超標 ' + str(sum(any(r['nError'] is not None and r['nError']['maxAbs'] > .01 for r in j['errors']['regions']) for j in local_jobs)) + '/30組、厚差超標 ' + str(sum(abs(j['errors']['thicknessError']) > .1 for j in local_jobs)) + '/30組；3c n/厚差超標 ' + str(sum(any(r['nError'] is not None and r['nError']['maxAbs'] > .01 for r in j['errors']['regions']) for j in auto_jobs)) + '/' + str(sum(abs(j['errors']['thicknessError']) > .1 for j in auto_jobs)) + '（各5組）。',
              '結論：只量得表差、內插敏感度與合成膜偏差；不同文獻的差異不是準確度信賴區間，三次內插不保證逐段改善；不據單一樣品推定原因。',
              '限制：190–206.6僅模型；透明k固定0不能證明吸收精度；本階段未換Si表、未選4.9c方案。補充規劃保留原38行再追加9行，未納入commit；不推送／部署。']
    assert len(lines) <= 120, f'report exceeds120 lines: {len(lines)}'
    guard()
    (ROOT / 'STAGE4_9A_REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='')
    save('report-metrics', {'lines': len(lines), 'local_jobs': len(local_jobs), 'automatic_jobs': len(auto_jobs),
                            'flags': [{'key': j['key'], 'flags': flags(j)} for j in c['jobs']],
                            'report_sha256': hashlib.sha256((ROOT / 'STAGE4_9A_REPORT.md').read_bytes()).hexdigest()})
    print(json.dumps({'report_lines': len(lines)}, ensure_ascii=True))


if __name__ == '__main__':
    {'verify': verify, 'desktop': desktop, 'report': report}[sys.argv[1]]()
