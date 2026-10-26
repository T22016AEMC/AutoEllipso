"""Apply only the explicitly approved v2 revisions, retaining the complete v1 archive."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.qa'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert not (QA / 'stage4_9b-v2-frozen.json').exists(), 'v2 already frozen'
    settings = json.loads((QA / 'stage4_9b-v1-settings.json').read_text(encoding='utf-8'))
    old = json.loads((QA / 'stage4_9b-v1-frozen.json').read_text(encoding='utf-8'))
    assert sha(QA / 'stage4_9b-v1-settings.json') == old['settings_sha256']
    assert sha(QA / 'stage4_9b-v1-frozen-report.md') == old['report_sha256']
    assert sha(Path(settings['si_final']['path'])) == old['si_final_sha256']
    for name, expected in old['src'].items():
        assert sha(ROOT / name) == expected
    settings['revision'] = 2
    settings['previous_revision'] = {'settings_sha256': old['settings_sha256'], 'report_sha256': old['report_sha256'], 'archive_manifest': '.qa/stage4_9b-v1-archive-manifest.json'}
    settings['stage0_forward_gate']['decision'] = 'report only, no stopping; >=.003 remains historical diagnostic flag'
    settings['stage0_revision'] = 'user-authorized rerun of stage0 only; preserve v1 results including Psi.008297828696157694 and Delta.028349264208884506deg; these are comparable in magnitude to .03deg noise and an uncertainty lower bound for all later conclusions'
    settings['SiF_dense_cs'] = 'native epsilon vs energy CubicSpline not-a-knot, extrapolate=False, same below1eV zero rule; independent resampling190..900/1nm; sensitivity reference only, never primary truth or candidate'
    settings['interp_floor'] = {'psi': 'global maxAbs forward PCHIP-CS on frozen stage0 film/10nm grid/3AOIs', 'delta': 'same, shortest circular difference', 'n': 'global maxAbs PCHIP-CS n on integer190..900nm', 'k': 'same for k', 'epsilon': 'global max complex absolute epsilon difference on integer190..900nm; additionally report components and native-interval100 subdivisions with locations', 'thickness_nm': 'NA／無法判定; no thickness interp_floor defined; keep .1nm flag', 'annotation': 'each matching-unit max/RMS result tagged strictly below interp_floor => 無法與內插不確定度區分; angle conclusions additionally respect maximum of historical linear-PCHIP lower bound and PCHIP-CS floor; keep both annotations separately; substrate n/k floor is a sensitivity scale, not calibrated film uncertainty'}
    settings['stage3_extra'] = {'truth': 'SiF-cs', 'film_index': 0, 'thickness_nm': 60, 'seed': 60002, 'candidates': ['C0', 'C1', 'C2', 'C3'], 'local_fits': 4, 'total_stage3_local_fits': 148, 'scope': 'only3a forward and3b Cauchy60; share identical noise draws with Si-final/PCHIP Cauchy60; report separately, exclude primary nonself aggregates; no additional fit expansion'}
    settings['thickness_sensitivity'] = 'four signed nm differences d_fit(SiF-cs)-d_fit(Si-final/PCHIP) for same C0..C3, Cauchy60, same seed60002; single film and thickness only; descriptive samples, not interp_floor and never transferred as labels to other cells'
    settings['stage3_seeds'] = settings['stage3_seeds'].replace('36 datasets/144 local fits including self-consistency cells', 'original36 datasets/144 local fits unchanged including self-consistency cells; plus4 explicitly approved extra fits using same60002 noise; stage3 total exactly148')
    settings['stop'] = 'design/input inconsistency only; stage0 .003deg threshold is report-only and never stops. Preserve frozen design; no source/settings changes based on results.'
    settings['checkpoint_revision'] = 'v2 checkpoints use .qa/stage4_9b-v2-*; no v1 overwritten; stage0 is the sole authorized numerical rerun; no completed v2 fit rerun'
    text = json.dumps(settings, ensure_ascii=False, indent=2) + '\n'
    settings_sha = hashlib.sha256(text.encode()).hexdigest()
    report = (QA / 'stage4_9b-v1-frozen-report.md').read_text(encoding='utf-8')
    report = report.replace('（凍結設計）', '（v2凍結設計）')
    report = report.replace(old['settings_sha256'], settings_sha)
    report = report.replace('任一maxAbs Ψ或圓周Δ差≥.003°立即停止。', '線性/PCHIP差與.003°門檻只報告、不停止。')
    report = report.replace('36資料集×4候選=144局部擬合。', '原36資料集×4候選=144局部擬合；另加SiF-cs/Cauchy60×4，共固定148次，不再新增。')
    report = report.replace('若0門檻觸發或設計錯誤：立即停止、記錄、回報', '若設計錯誤：立即停止、記錄、回報')
    report = report.replace('目前：設計凍結完成，尚未開始比較或擬合。', '目前：v2設計凍結完成；下一步依使用者授權重算階段0，再接續1–4。')
    report += '\n' + '\n'.join([
        'v2明確修訂（其餘候選、方法、網格、原種子與門檻不變）：',
        'v1設定／設計／階段0結果與SHA封存.qa/stage4_9b-v1-*；只有階段0獲授權重算，已保存擬合重跑0。',
        '線性/PCHIP在E₁區最大Ψ差.0083°、Δ差.0283°，與.03°雜訊同量級；後續所有結論以此為不確定度下限，不因原.003°閘門停止。',
        '新增SiF-dense-cs：原生ε–E not-a-knot三次樣條，同樣不數值外推，作敏感度基準；主要Si-final真值仍PCHIP。',
        'interp_floor各一：Ψ／圓周Δ為同0前向最大差；n/k為190–900/1nm最大差；ε為同格點複數差絕對值最大，另列ε₁/ε₂與原生細分差。',
        '各階段每個同量綱結果附「是否小於interp_floor」；小於者標「無法與內插不確定度區分」。角度另標是否低於線性/PCHIP與CS差的較大下限。',
        '原>.03°／膜n>.01／厚差>.1nm標記不變；膜厚interp_floor一律NA／無法判定，禁止拿角度或n/k floor比較nm。',
        '新增4格：SiF-cs真值／Cauchy60／C0–C3，seed60002與原PCHIP對照共用雜訊；只用3a/3b，不納主要非自洽彙總。',
        '另列4筆有號膜厚差d_fit(cs)−d_fit(PCHIP)：只含單一膜、單一厚度的敏感度樣本，不是interp_floor，不替其他格貼標籤。',
        'n/k的基板interp_floor僅作敏感度比較尺度，不等於已校準的膜參數不確定度；σ與statistics公式均不修改。',
    ]) + '\n'
    frozen = {**old, 'revision': 2, 'settings_sha256': settings_sha, 'report_sha256': hashlib.sha256(report.encode()).hexdigest(), 'previous': settings['previous_revision']}
    for path, contents in [(QA / 'stage4_9b-settings.json', text), (QA / 'stage4_9b-v2-settings.json', text), (QA / 'stage4_9b-v2-frozen-report.md', report), (ROOT / 'STAGE4_9B_REPORT.md', report)]:
        path.write_text(contents, encoding='utf-8', newline='')
    with (QA / 'stage4_9b-v2-frozen.json').open('x', encoding='utf-8', newline='') as stream:
        json.dump(frozen, stream, ensure_ascii=False, indent=2)
    print(json.dumps({'settings_sha256': settings_sha, 'report_sha256': frozen['report_sha256'], 'lines': len(report.splitlines())}))


if __name__ == '__main__':
    main()
