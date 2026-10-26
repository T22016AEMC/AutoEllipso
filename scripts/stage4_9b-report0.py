"""Report a checkpointed stage0 stop; never starts another numerical job."""
import hashlib
import json
from pathlib import Path

from importlib.util import module_from_spec, spec_from_file_location

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.qa'


def read(name):
    return json.loads((QA / ('stage4_9b-' + name + '.json')).read_text(encoding='utf-8'))


def main():
    spec = spec_from_file_location('stage0_guard', ROOT / 'scripts/stage4_9b-stage0.py')
    guard = module_from_spec(spec)
    spec.loader.exec_module(guard)
    guard.guard()
    registration, epsilon, forward, outcome = [read(n) for n in ['registration', 'native-epsilon-interpolation', 'native-forward-interpolation', 'stage0']]
    assert outcome['stopped'], 'this report is specifically for a frozen-gate stop'
    frozen = read('frozen')
    text = (QA / 'stage4_9b-frozen-report.md').read_text(encoding='utf-8')
    text = text.replace('目前：設計凍結完成，尚未開始比較或擬合。', '目前：階段0未通過固定門檻，立即停止；未開始階段1–4、verify或commit。')
    lines = [text.rstrip(), '', '階段0登記與停止結果（原始輸出.qa/stage4_9b-*）：', '',
             '凍結設計報告SHA256：`' + frozen['report_sha256'] + '`；凍結settings與外部MAT雜湊均重新核對一致。',
             '檔案為文字格式（非二進位MATLAB容器）；檔頭原文：' + registration['header'][0] + '；欄位eV/e1/e2。',
             f"原生{registration['rows']}列，E={registration['energy_range_eV'][0]}–{registration['energy_range_eV'][1]}eV，λ={registration['wavelength_range_nm'][0]:.6f}–{registration['wavelength_range_nm'][1]:.6f}nm。",
             '實際步長：' + '；'.join(f"{r['step_eV']}eV×{r['intervals']}區間，E={r['interval_energy_extent']}" for r in registration['steps']) + '，與指定分段一致。',
             'ε₂往低E單調不增且末端為零的最大原生連段：' + '；'.join(f"{r['from_eV']}→{r['to_eV']}eV／{r['rows']}列" for r in registration['native_nonincreasing_runs_ending_at_zero']) + '。',
             f"E<1eV共{registration['below1eV_native_rows']}列，原檔ε₂非零{registration['below1eV_native_nonzero_epsilon2']}列；記憶體強制0、不改原檔。",
             f"論文量測域.75–6.5eV；λ<{registration['model_extrapolation_below_nm']:.6f}nm標「外推」。原檔E<.75亦超出論文量測域，不作量測證據，後續190–900資料不會使用該低E段。",
             '原生區間各100等分，共' + str(epsilon['points']) + '個不同E點；以下差均為線性−PCHIP。', '',
             '|ε分量|最大絕對差|E(eV)|λ(nm)|全檔RMS|', '|---|---|---|---|---|']
    for key in ['epsilon1', 'epsilon2']:
        row = epsilon[key]
        lines.append(f"|{key}|{row['maxAbs']:.10g}|{row['at_eV']:.7g}|{row['at_nm']:.7g}|{row['rms']:.10g}|")
    lines += ['', 'ε差的論文量測域／高能外推分項完整列於`.qa/stage4_9b-native-epsilon-interpolation.json`。',
              '前向檢查216點（72波長×3AOI），無雜訊；Cauchy參數、膜厚與固定門檻均同凍結設計。', '',
              '|域／分量|最大絕對差(°)|波長(nm)|AOI(°)|RMS(°)|', '|---|---|---|---|---|']
    for name, label in [('global', '全域'), ('measured', '論文量測域'), ('extrapolated', '外推')]:
        for key, component in [('psi', 'Ψ'), ('delta', '圓周Δ')]:
            row = forward[name][key]
            lines.append(f"|{label}/{component}|{row['maxAbs']:.10g}|{row['at_nm']}|{row['aoi']}|{row['rms']:.10g}|")
    lines += ['', '最大角差' + f"{outcome['forward_max_degrees']:.10g}°≥.003°；兩分量各自亦超標，發生於360nm（論文量測域內），非由190nm外推點觸發。",
              '結論僅為「未通過本次新設.003°門檻」；此門檻非已驗證結論。候選表、取樣密度、短波段貢獻及緊湊表是否足夠：無法判定，尚未執行。', '',
              '補列4.9a既存250–400nm參考配對（直接讀檔，沒有重算／重新選擇）；每格最大差@nm：', '',
              '|配對|n線性|n PCHIP|k線性|k PCHIP|', '|---|---|---|---|---|']
    prior = json.loads((QA / 'stage4_9a-pchip-reference-check.json').read_text(encoding='utf-8'))
    for row in prior['pairs']:
        cells = [str(row['pair'][0]) + '–' + str(row['pair'][1]) + ' ' + '/'.join(row['entries'])]
        for component, method in [('n', 'linear'), ('n', 'pchip'), ('k', 'linear'), ('k', 'pchip')]:
            value = row[component][method]
            cells.append(f"{value['max_abs']:.9g}@{value['wavelength_nm']}")
        lines.append('|' + '|'.join(cells) + '|')
    lines += ['', f"階段0耗時{outcome['elapsed_seconds']:.3f}秒；階段1–4、verify、commit均未執行；剩餘時間不估（已停止等待指示）。",
              '檢查點：registration、native-epsilon-interpolation、native-forward-interpolation、stage0、stopped；沒有中斷中的擬合，重算範圍0，已存結果重跑0。',
              '原檔與src雜湊不變；設定凍結後未調整；不推送／部署。補充規劃與MAT均未加入Git；本報告／新診斷亦尚未提交。']
    report = '\n'.join(lines) + '\n'
    count = len(report.splitlines())
    assert count <= 120, f'report too long: {count}'
    guard.guard()
    (ROOT / 'STAGE4_9B_REPORT.md').write_text(report, encoding='utf-8', newline='')
    target = QA / 'stage4_9b-report0-metadata.json'
    target.write_text(json.dumps({'lines': count, 'report_sha256': hashlib.sha256(report.encode()).hexdigest(),
                                 'frozen_report_sha256': frozen['report_sha256'], 'settings_unchanged': True}, indent=2) + '\n', encoding='utf-8', newline='')
    print(json.dumps({'report_lines': count, 'stopped': True}))


if __name__ == '__main__':
    main()
