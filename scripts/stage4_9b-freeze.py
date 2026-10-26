"""Freeze the user-approved 4.9b design without evaluating optical data."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.qa'
PYTHON = r'C:\Users\t22016\AutoEllipso_Stage4_9A_venv_20261026\Scripts\python.exe'
MAT = Path(r'C:\Users\t22016\Desktop\程式\autoellipso\si-final.mat')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert not (QA / 'stage4_9b-frozen.json').exists(), 'already frozen; never overwrite'
    old = json.loads((QA / 'stage4_9b-settings.json').read_text(encoding='utf-8'))
    assert digest(MAT) == old['si_final']['sha256']
    registration = json.loads((QA / 'stage4_9a-registration.json').read_text(encoding='utf-8'))
    references = {r['path']: r['sha256'] for r in registration['registration']}
    for path, expected in references.items():
        assert digest(Path(path)) == expected, '4.9a reference changed: ' + path
    settings = {
        'stage': '4.9b', 'design_status': 'frozen before comparisons or fitting',
        'base': '9f4d2ae', 'python': PYTHON, 'si_final': old['si_final'],
        'offline': True, 'install': False, 'production_changes': False,
        'data_policy': 'read original external MAT/YAML only; no moving, editing, copying reference tables or writing sampled Si/epsilon arrays into project; worker inputs in RAM stdin only; derived differences/fit results in .qa only',
        'hc_eVnm': 1239.841984,
        'bands': [[190, 250, False], [250, 400, False], [400, 900, True], [190, 207, False], [207, 250, False]],
        'paper_range_eV': [.75, 6.5],
        'extrapolation_label': 'E>6.5 (lambda<hc/6.5), including190nm, is model extrapolation; report separately in every stage, never treat as measured',
        'stage0_registration': 'parse original text header eV/e1e2 and3 numeric columns; SHA/bytes/rows/energy min/max; unique rounded energy steps and their locations/counts; maximal nonincreasing epsilon2 runs as energy decreases, including zero tail; report native epsilon2 below1eV before override',
        'epsilon2_below1eV': 'set to0 in RAM both at native controls and all query energies<1; never edit source file',
        'stage0_interpolation_grid': 'each native energy interval subdivided into100 equal intervals including endpoints; compare epsilon-energy linear vs PCHIP, report component max/location/RMS; no extrapolation outside native file domain',
        'stage0_forward_gate': {'film': {'model': 'cauchy', 'parameters': {'A': 1.60, 'B': .0040, 'C': .0001, 'k0': 0}}, 'thickness_nm': 60, 'aois': [65, 70, 75], 'wavelengths_nm': list(range(190, 901, 10)), 'stop_at_or_above_degrees': .003, 'metric': 'maxAbsPsi OR maxAbs circularDelta, across all wavelengths/AOIs, including explicitly labeled extrapolation; no noise', 'meaning': 'newly stipulated threshold, not a validated conclusion'},
        'SiF_dense': 'native epsilon-energy PCHIP at integer190..900nm; model-extrapolated190nm explicitly labeled; no array persisted',
        'stage0_prior_C1': 'read .qa/stage4_9a-pchip-reference-check.json, report5 fixed pairs max n/k and positions for both linear/PCHIP, do not recompute or select',
        'stage1': 'application getSiliconOpticalConstants vs SiF-dense at1nm; all5 bands plus extrapolation-only subset, maxAbs/location/RMS; reference n/k PCHIP vs wavelength on native-valid intersect requested domains; epsilon conversion only after evaluating n/k',
        'references': [{'id': 'Aspnes', 'lo': 210, 'hi': 820}, {'id': 'Jellison', 'lo': 240, 'hi': 840}, {'id': 'Green-2008', 'lo': 250, 'hi': 900}, {'id': 'Schinke', 'lo': 250, 'hi': 900}, {'id': 'Franta-25C', 'lo': 190, 'hi': 900, 'model_output': True}],
        'floor_lit': 'per band and n/k separately: largest single-reference maxAbs error, largest single-reference RMS error vs SiF-dense; all5 references within their own requested domain; zero denominators NA; report application/floor ratios, no correct/incorrect claim',
        'stage2_lambda_steps_nm': [1, 2, 5, 10, 20, 25],
        'stage2_energy_steps_eV': [.01, .02, .05, .1, .2],
        'stage2_sampling': 'lambda grids start190 end900; energy grids start hc/900 end hc/190; append final endpoint if step does not divide range, label shortened final interval; epsilon-energy PCHIP through SiF-dense defines continuous off-grid sampling; never extrapolate',
        'stage2_methods': ['n/k-lambda linear', 'epsilon-lambda linear', 'epsilon-energy linear', 'epsilon-energy PCHIP', 'epsilon-lambda PCHIP'],
        'stage2_epsilon_to_nk': 'n=sqrt((abs(epsilon)+epsilon1)/2), k=sqrt((abs(epsilon)-epsilon1)/2); reject negative epsilon2 or nonfinite inputs, no silent negative-k clipping',
        'stage2_forward': 'same film/grid/AOIs as stage0; all55 grid/method combinations, noise-free baseline SiF-dense; maxAbsPsi/circularDelta by5 bands and extrapolation; flag>.03; report coarsest tested spacing separately per grid family/method for both global maxima strictly<.03; do not choose production setting',
        'candidates': {'C0': 'unchanged31-point getSiliconOpticalConstants n/k wavelength linear', 'C1': 'SiF-dense sampled at190..900 step5nm, epsilon-energy PCHIP evaluation', 'C2': 'SiF-dense1nm, epsilon-energy PCHIP evaluation', 'C3': '190..1000 Si-final/Aspnes/Green2008 epsilon blend; native Si-final epsilon-energy PCHIP, references n/k wavelength PCHIP then epsilon; first cosine blend206.6..212 (Si-final to Aspnes), second822..826.6 (Aspnes to Green); complete0..1 cosine weights within each actual blend; controls1nm plus206.6/207/212/822/826.6/827; epsilon-energy PCHIP resample1nm, evaluate same way'},
        'C3_revision': 'mixed widths are no longer both10nm:5.4nm and4.6nm; no reference numerical extrapolation',
        'truths': [{'id': 'Si-final', 'lo': 190, 'hi': 900}] + [{'id': r['id'], 'lo': r['lo'], 'hi': r['hi']} for r in [{'id': 'Aspnes', 'lo': 210, 'hi': 820}, {'id': 'Jellison', 'lo': 240, 'hi': 840}, {'id': 'Green-2008', 'lo': 250, 'hi': 900}, {'id': 'Schinke', 'lo': 250, 'hi': 900}, {'id': 'Franta-25C', 'lo': 190, 'hi': 900}]],
        'films': [{'id': 'Cauchy', 'model': 'cauchy', 'parameters': {'A': 1.52, 'B': .0045, 'C': .00008, 'k0': 0}, 'fit': ['A', 'B', 'C']}, {'id': 'Gaussian', 'model': 'gaussian', 'parameters': {'eps_inf': 2.5, 'A': 1.8, 'E0': 3.5, 'sigma': .45, 'A2': 0, 'E02': 4.8, 'sigma2': .7, 'A3': 0, 'E03': 5.6, 'sigma3': .9}, 'fit': ['eps_inf', 'A', 'E0', 'sigma']}],
        'thicknesses_nm': [20, 60, 100], 'aois': [65, 70, 75], 'sigma_degrees': .03,
        'stage3_seeds': '60001+100*truth_index+10*film_index+thickness_index; zero-based orders above; same generated dataset for all4 candidates;36 datasets/144 local fits including self-consistency cells',
        'noise': '4.9a LCG1664525/1013904223 uint32(state+.5)/2^32 paired Box-Muller, AOI-major wavelength-major, formal Delta normalization',
        'local_fitting': 'unchanged optimizeBoundedLM direct true-start,50 iterations,ftol1e-5,existing xtol/gtol,initialLambda.01; sigma weights; thickness1..200, registry material bounds, fit keys above only; no coarse scan, no regularization',
        'substrate_injection': 'script-only registered tabulated model returning in-memory candidate optical constants at each measured wavelength; official optimizer/statistics/Automatic/TMM untouched; all C0 calculations use original tabulated_si; no source edits or table files',
        'stage3_self': 'Si-final truth with C1/C2 shares source: label self-consistent, calculate but exclude aggregation; other candidates no entire identical truth table',
        'stage3_aggregate': 'per candidate/nonself truth cohort and band: largest abs Psi/Delta/n/k/d error and pooled point RMS (all3AOIs for angles, unique wavelengths for film n/k, one d per dataset); report dataset counts; C0 ratios use same truth cohort as compared candidate',
        'compact_label': 'substrate n/k representation ONLY: common5 non-Si-final references, per-band worst maxAbs and worst single-reference RMS vs C1/C2; absolute difference between C1/C2 worst metrics must be strictly<.1 of corresponding floor_lit for both n/k and max/RMS in all available bands; no conclusion where floor missing/zero; angles, film n/k, thickness excluded; stage2 forward independently reported',
        'flags': {'forward_degrees_strictly_greater': .03, 'film_n_maxAbs_strictly_greater': .01, 'thickness_abs_nm_strictly_greater': .1, 'decision': 'descriptive flags only, no best-candidate judgment'},
        'stage4': {'truth': 'Si-final', 'films': ['Cauchy', 'Gaussian'], 'thickness': 60, 'seeds': [61001, 61002], 'substrates': ['Si-final', 'Aspnes', 'Jellison'], 'ranges': {'Si-final': [[190, 900], [210, 900], [250, 900], [400, 900]], 'Aspnes': [[210, 820], [210, 820], [250, 820], [400, 820]], 'Jellison': [[240, 840], [240, 840], [250, 840], [400, 840]]}, 'datasets': 'one full Si-final dataset per film, subset identically per range/substrate;24 local fits; A/B duplicates for literature count separately but reuse identical fit checkpoint if inputs exactly equal, recording cache use', 'limitation': 'Aspnes/Jellison cannot identify contribution below207nm; only Si-final self-consistency group covers it', 'statistics': 'formal computeFitStatistics with exact local residual and sigma weights; parameter stdError unchanged; n/k delta method with formal centralDifferenceJacobian divided by each variable bound span to get physical derivatives, using formal covariance, Angular=false; boundary/nonidentifiable missing covariance or nonfinite uncertainty NA; bandRMS of finite curve stdErrors and per-parameter errors, range ratios vs A only within same substrate/film; n/k truth errors reported only fitted wavelengths'},
        'automatic': [{'truth': 'Si-final', 'candidate': 'C0', 'film': 'Gaussian', 'thickness': 60, 'seed': 60012, 'range': [190, 900]}, {'truth': 'Jellison', 'candidate': 'C1', 'film': 'Gaussian', 'thickness': 60, 'seed': 60212, 'range': [240, 840]}],
        'automatic_config': 'complete official Automatic; targetModelId gaussian both cases; same default multi-AOI project initialization d88/Cauchy1.45, sigma mode50/1e-5, only substrate and data-fit wavelength bounds changed; report selected freeFormModel thickness/curve/count/scale, never physical thickness in place of free thickness',
        'execution': 'serial, atomic per-job checkpoint; saved results never rerun; check every15min and report stage completion/errors only; interrupt reason and unsaved rerun scope recorded',
        'verify': 'one full pnpm run verify only at completed audit close; compare failure names/full details with .qa/stage4_9a-scientific-tests.json; no assertions changed',
        'stop': 'stage0 gate>=.003 or design error: immediately record and report; no later stages/verify/commit until user instruction; no settings revision or rerun',
        'report_commit': 'STAGE4_9B_REPORT.md<=120 lines; checkpoint results .qa/stage4_9b-* ignored; commit only new diagnostics and report, not supplementary planning or MAT; no push/deploy',
    }
    report = [
        '# Stage 4.9b：Si 基板候選表與短波段貢獻診斷（凍結設計）', '',
        '基準9f4d2ae／v2.2-integration；只新增診斷與報告；不改src、容差、迭代上限、既有斷言、部署；離線指定venv。',
        '原檔唯讀、不搬移、不複製、不Git追蹤：`' + str(MAT) + '`；15167 bytes；SHA256 `' + digest(MAT) + '`。',
        '完整設定／方法／來源雜湊在.qa/stage4_9b-settings.json；原稿另存frozen-report.md；本稿以下方法於比較前凍結。',
        'Si-final：ε對E原生PCHIP；E<1ε₂在記憶體設0；λ=1239.841984/E；依指定ε→n/k公式；E>6.5標模型外推，190nm亦單列，不當量測。',
        '階段0：登記列數、能量域／間距／ε₂趨零段；每原生區間100等分比較線性/PCHIP的ε最大差及位置/RMS。',
        '0前向門檻：Cauchy A1.60/B.0040/C.0001/k0=0，60nm，AOI65/70/75，190–900/10nm；任一maxAbs Ψ或圓周Δ差≥.003°立即停止。',
        '.003°為本次新設門檻，非已驗證結論；ε差完整報告。另照讀4.9a已保存的5對linear/PCHIP最大n/k差與位置，不重算。',
        'SiF-dense：原生ε–E PCHIP在190–900/1nm；不保存原表、稠密Si值或worker輸入，僅存中繼資料／差異／擬合結果。',
        '所有報告分[190,250)、[250,400)、[400,900]、[190,207)、[207,250)及外推子段；缺域NA、不數值外推。',
        '階段1：現行表與5來源各對SiF-dense；參考n/k對λ PCHIP，Aspnes210–820、Jellison240–840、Green2008/Schinke250–900、Franta25C190–900(模型)。',
        'floor_lit各段各n/k分別取最大單表maxAbs與最大單表RMS；只列現行表/floor倍率，不下正誤結論。',
        '階段2：λ步長1/2/5/10/20/25nm；E步長.01/.02/.05/.1/.2eV；起訖依190/900，補終點並註明尾段不等長；離格抽樣用SiF-dense ε–E PCHIP。',
        '55組重建：n/k–λ線性、ε–λ線性、ε–E線性、ε–E PCHIP、ε–λ PCHIP；各段n/k max/RMS及同0電影響，>.03°標記；只列最稀通過格距，不選用。',
        'C0現行31點；C1 SiF5nm／C2 SiF1nm，皆ε–E PCHIP；C3 Si-final→Aspnes→Green2008，ε餘弦混合後PCHIP取1nm。',
        '規格修訂：C3混合206.6–212與822–826.6nm，各自完整餘弦權重；混合寬度不再都是10nm，分別5.4與4.6nm。',
        '3真值6組：Si-final190–900，加上述5來源；2膜×20/60/100nm、AOI65/70/75、10nm、σ=.03°；36資料集×4候選=144局部擬合。',
        'Cauchy A1.52/B.0045/C.00008/k0=0；Gaussian ε∞2.5/A1.8/E0=3.5/σ.45，其餘振子關閉；fit鍵／完整參數見settings。',
        '種子60001+100t+10f+d，固定0起索引；同資料給4候選；LCG/BoxMuller及Δ正規化沿用4.9a。',
        '3b/4：真值起點直接原LM50次、ftol1e-5、既有xtol/gtol、λ初值.01，σ權重；厚1–200、材料registry邊界，無粗掃或正則。',
        '只在診斷process註冊記憶體基板模型；正式TMM、LM、statistics、Automatic全不改；C0用原tabulated_si。',
        'Si-final×C1/C2為同源自洽格，仍計算、排除彙總；其他彙總以非自洽cohort的最大值／點合併RMS，C0倍率採相同cohort。',
        '固定標記：maxAbs Ψ/圓周Δ>.03°、膜n>.01、abs厚差>.1nm；僅標記，不判候選最好。',
        '「緊湊表足夠」只限基板n/k表示精度：共同5非Si-final參考，各段C1/C2最壞max/RMS差皆<對應floor_lit10%；缺floor不下判定。',
        '階段2前向角差獨立列出、不納此標記；膜n/k／厚差仍完整報告，不能用基板floor直接判角度或厚度。',
        '4：Si-final真值、2膜60nm、61001/61002；每膜同一完整資料再切A/B/C/D，3擬合基板，共24格局部擬合，完全相同輸入共用檢查點並註記。',
        'Si-final範圍190/210/250/400–900；Aspnes210/210/250/400–820；Jellison240/240/250/400–840；皆10nm實際格點。',
        '限制：無法藉Aspnes/Jellison比較207nm以下貢獻；該段只能由Si-final自洽組呈現；非自洽A/B完全相同。',
        '不確定度：正式statistics參數stdError；n/k以其covariance與正式Jacobian(除bound span、非角度)作delta傳播；缺失NA；各段曲線σ RMS及相對A倍率。',
        'Automatic僅2例、皆Gaussian60/target Gaussian：Si-final真值/C0擬合(seed60012)，Jellison240–840真值/C1(seed60212)。',
        '官方預設d88/Cauchy1.45與原50次/1e-5配置，僅換基板／資料範圍；回報自由形式厚度／n/k／節點／平滑。',
        '串行、逐作業原子檢查點、不重跑已存；15分鐘查狀態，僅階段完成／異常回報；中斷先說明與記錄未存重算範圍。',
        '全階段完成才完整verify一次，對照4.9a兩項既有失敗名稱與完整內容；任何新增／變更單列；不改斷言。',
        '若0門檻觸發或設計錯誤：立即停止、記錄、回報，不執行後續、verify或commit，等待使用者指示；不改設定後重跑。',
        '只commit新增診斷／本報告；.qa、補充規劃、MAT不commit；不部署、不推送。',
        '目前：設計凍結完成，尚未開始比較或擬合。',
    ]
    settings_text = json.dumps(settings, ensure_ascii=False, indent=2) + '\n'
    settings_sha = hashlib.sha256(settings_text.encode()).hexdigest()
    report.insert(5, 'settings SHA256：`' + settings_sha + '`。')
    report_text = '\n'.join(report) + '\n'
    for name in ['settings.json', 'STAGE4_9B_REPORT.md']:
        source = QA / 'stage4_9b-settings.json' if name == 'settings.json' else ROOT / name
        target = QA / ('stage4_9b-draft-' + name)
        with target.open('xb') as stream:
            stream.write(source.read_bytes())
    for path, text in [(QA / 'stage4_9b-settings.json', settings_text), (ROOT / 'STAGE4_9B_REPORT.md', report_text), (QA / 'stage4_9b-frozen-report.md', report_text)]:
        path.write_text(text, encoding='utf-8', newline='')
    frozen = {'settings_sha256': settings_sha, 'report_sha256': hashlib.sha256(report_text.encode()).hexdigest(),
              'si_final_sha256': digest(MAT), 'references': references,
              'prior_pchip_sha256': digest(QA / 'stage4_9a-pchip-reference-check.json'),
              'registration_sha256': digest(QA / 'stage4_9a-registration.json'),
              'src': {str(p.relative_to(ROOT)).replace('\\', '/'): digest(p) for p in (ROOT / 'src').rglob('*') if p.is_file()}}
    with (QA / 'stage4_9b-frozen.json').open('x', encoding='utf-8', newline='') as stream:
        json.dump(frozen, stream, ensure_ascii=False, indent=2)
    print(json.dumps({'settings_sha256': settings_sha, 'report_sha256': frozen['report_sha256'], 'report_lines': len(report)}))


if __name__ == '__main__':
    main()
