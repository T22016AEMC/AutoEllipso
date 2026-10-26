"""Freeze the approved 4.9a experiment before any application/reference comparison."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = ROOT / '.qa' / 'stage4_9a-'
PYTHON = r'C:\Users\t22016\AutoEllipso_Stage4_9A_venv_20261026\Scripts\python.exe'
SETTINGS = {
    'base': '895dec2f25e0bbcfee953aca83eec21750b0536e', 'python': PYTHON,
    'offline': True, 'install': False, 'production_changes': False,
    'bands': [[190, 250, False], [250, 400, False], [400, 900, True]],
    'reference_interpolation': 'linear n/k vs wavelength, scipy interp1d bounds_error=True; micrometers*1000 ->nm; absent component stays NA',
    'stage1_grid_nm': list(range(190, 1201)),
    'stage1': 'all14 registered candidates, each component only in native range; three-band differences max/location/RMS; 900–1200 behavior explicitly outside current table beyond1000',
    'envelope': 'all native-valid registered candidates; count independent Franta model family once; min/max over available entries when >=2 source families; single-family points report nominal Franta-25C difference only;190–206.6 always single source(model), no correct/incorrect conclusion',
    'reference_sensitivity': 'authorized C1 five fixed pairs linear/PCHIP at integer250..399, report both maxima and locations; no reference-interpolation change based on C1',
    'dense_reference': 'Franta-25C', 'dense_grid_nm': list(range(190, 901)),
    'dense_label': 'Franta2017/2018 model output, not original measurements; 1nm linear resampling of4001 native points',
    'stage2': 'sample the existing31 application-table wavelengths from this same Franta reference (including950/1000, within native domain); reconstruct only190..900; isolate sampling/interpolation, no application n/k values used as controls',
    'stage2_methods': ['linear n,k vs wavelength', 'not-a-knot cubic epsilon vs wavelength', 'not-a-knot cubic epsilon vs photon energy'],
    'stage2_inverse_epsilon': 'principal complex square root with nonnegative real part; retain signed imaginary part; count any negative k; no clipping',
    'energy_constant_eVnm': 1239.841984,
    'substrates': [{'id': 'Franta-25C', 'lo': 190, 'hi': 900, 'model_output': True},
                   {'id': 'Aspnes', 'lo': 210, 'hi': 820, 'model_output': False},
                   {'id': 'Jellison', 'lo': 240, 'hi': 840, 'model_output': False},
                   {'id': 'Green-2008', 'lo': 250, 'hi': 900, 'model_output': False},
                   {'id': 'Schinke', 'lo': 250, 'hi': 900, 'model_output': False}],
    'stage3_excluded': ['Chandler-Horowitz', 'Edwards', 'Salzberg', 'Daub', 'Li-293K', 'Franta-20C'],
    'aois': [65, 70, 75], 'thicknesses_nm': [20, 60, 100], 'wavelength_step_nm': 10, 'sigma_degrees': .03,
    'films': [{'id': 'Cauchy', 'model': 'cauchy', 'parameters': {'A': 1.72, 'B': .0031, 'C': .00004, 'k0': 0}, 'fit': ['A', 'B', 'C']},
              {'id': 'Gaussian', 'model': 'gaussian', 'parameters': {'eps_inf': 2.7, 'A': 1.7, 'E0': 3.6, 'sigma': .5, 'A2': 0, 'E02': 4.8, 'sigma2': .7, 'A3': 0, 'E03': 5.6, 'sigma3': .9}, 'fit': ['eps_inf', 'A', 'E0', 'sigma']}],
    'seeds': '59001+100*substrate_index+10*film_index+thickness_index; indexes zero-based fixed order; 3c reuses Gaussian60 dataset',
    'noise': 'LCG1664525/1013904223 uint32, (state+.5)/2^32, paired Box-Muller per point; AOI-major then wavelength-major; normalize noisy Delta with formal normalizeDeltaDeg',
    'stage3a': 'noise-free true film and same formal TMM, reference vs application Si; circular Delta; max/RMS degrees by band across all3 AOIs; forward flags maxAbsPsi>.03 and/or maxAbsDelta>.03',
    'stage3b': 'direct unchanged optimizeBoundedLM (no coarse scan), true parameters/thickness start, one joint all-AOI fit;50 iterations,ftol=1e-5,existing xtol/gtol,lambda=.01,sigma weights; thickness1..200, model-variable registry bounds, inactive oscillators/k0 fixed; no regularization',
    'stage3c': 'five complete official Automatic calls, Gaussian60 per substrate, targetModelId=gaussian, official multi-AOI initialization d88/CauchyA1.45/config50/1e-5 with only data wavelength range changed; standard_deviation; select free curve and thickness from freeFormModel, no optimization settings changed',
    'errors': 'film n/k maxAbs/location/RMS and signed mean per region on measured wavelength grid only, absent band NA; signed thickness error; maxAbs n>.01 and abs thickness>.1 flag; descriptive only',
    'stage4_counter': 'V1,V3,V6/49001 sigma full Automatic; isolated esbuild in-memory onLoad transform of Complex constructor only, same-line hook before existing finite sanitization; count constructors and each real/imaginary component, stack-map locations; no src writes; control(NaN,Infinity) then reset; compare physical thickness/free-curve/coefficients with saved4.8c outputs, <=1e-9; throw on mismatch',
    'stage4_static': 'TypeScript AST inventory direct BSplineModel.calculateN/K, evaluate getEffectiveKnotsAndCount, registry/model dispatch and calculator callers; record metadata producer sites; unknown dynamic provenance explicitly undetermined',
    'stage4_bundle': ['src/fitting/residual.ts', 'src/fitting/engine.ts', 'src/fitting/autoWorkflow.ts', 'src/fitting/expertWorkflow.ts', 'src/fitting/freeFormRefine.ts', 'src/fitting/optimizer.ts', 'src/solver/ellipsometricAngles.ts', 'src/data/csvParser.ts', 'src/components/CsvImportModal.tsx', 'src/App.tsx', 'src/models/expertMixed.ts', 'src/components/ExpertFittingPanel.tsx', 'src/optics/complex.ts', 'src/optics/fresnel.ts', 'src/optics/materials.ts', 'src/models/base.ts'],
    'bundle_policy': 'complete saved source, ordered headers ===== path =====, no truncation; include all optics/base because no prior full-text bundle manifest supplied, deduplicate; report >1500-line files; .qa/audit-bundle-2.txt and Desktop copy',
    'verify': 'one full pnpm run verify; exact failed names/details compared with saved stage4_8c-scientific-tests.json; do not fix failures/assertions',
    'checkpoints': 'each completed local/Automatic/counter job persisted atomically, never rerun a saved job; interrupted unsaved work explicitly recorded; serial fitting',
    'commit': 'only new diagnostic scripts and STAGE4_9A_REPORT.md; supplemental planning file excluded; no push/deploy',
}


def main():
    text = json.dumps(SETTINGS, ensure_ascii=False, indent=2) + '\n'
    settings_hash = hashlib.sha256(text.encode()).hexdigest()
    lines = ['# Stage 4.9a：Si基板稽核（凍結設計）', '',
             '基準895dec2；v2.2-integration；只新增診斷腳本／報告，不改src、容差、上限、斷言、部署；離線、只用指定venv Python。',
             '原始輸出.qa/stage4_9a-*；補充規劃38行保留、不git add、不commit。正式完整verify僅一次。',
             '階段0b完成14候選登記及參考表彼此比較；C1完成指定5配對PCHIP敏感度；未用差異選來源或調門檻。',
             '資料庫為pyElli0.23.1內建快照；上游Git commit未附，無法判定；記錄14原始檔SHA256，不複製原始文獻表進專案。',
             '三波段[190,250)、[250,400)、[400,900]nm。缺分量/缺波段NA；禁止補0與外推。',
             '階段1：所有14候選分量各自有效域，1nm；每段Δn/Δk max/位置/RMS。900–1200另列現行程式的範圍外行為。',
             '包絡：至少2來源族時取所有有效候選min/max；Franta溫度族不算獨立來源；190–206.6只報Franta25C差且標單一來源(模型)，不下正誤結論。',
             '階段2：Franta25C模型輸出線性重採190–900/1nm；於現有31波長取樣，再用n/k波長線性、ε波長三次、ε能量三次重建。',
             '三次採not-a-knot且禁止外推；ε平方根保留k正負號，負k計數，不裁切；31節點含950/1000，其Franta取樣仍在原有效域。',
             '階段3真值Si：Franta25C190–900(模型輸出)、Aspnes210–820、Jellison240–840、Green2008與Schinke250–900；各自10nm，不取共同域。',
             'Cauchy A1.72/B.0031/C.00004/k0=0；Gaussian ε∞2.7/A1.7/E0=3.6/σ.5，其餘振子關閉，完整參數見settings。',
             '每基板×2膜×20/60/100nm，AOI65/70/75、σΨ=σΔ=.03°；種子59001+100r+10f+d；LCG/BoxMuller固定，3c共用Gaussian60資料。',
             '3a無雜訊前向差、Δ採最短角差；3b真值起點直接正式LM50次/ftol1e-5/既有xtol/gtol，不走engine厚度掃描；d1–200、材料參數用註冊邊界。',
             '3b透明k0及關閉振子固定；3c五次完整正式Automatic，沿用官方d88/CauchyA1.45初始化、原設定，只改資料範圍。',
             '分波段maxAbs n>.01、abs膜厚差>.1nm、maxAbs前向Ψ或Δ>.03°只做標記，另列RMS，不判斷好壞。',
             'S3 V1/V3/V6/49001：僅記憶體診斷副本插樁Complex建構子，控制NaN/Infinity後清零；與4.8c數值一致≤1e-9。',
             'S4 AST列直接/間接呼叫與_knot0/_knotCount，動態無法靜態判定就標無法判定；不改。',
             'S9依settings檔案順序完整串接，逐檔標頭、不截斷；>1500行另報，.qa/audit-bundle-2.txt與桌面各一份。',
             '逐作業原子檢查點；已保存不重算，串行。每15分鐘檢查，只於階段完成／異常回報。',
             '完整verify比較4.8c兩個既有SiO₂失敗的名稱及內容，新增/變更單獨列；只commit新診斷及報告，不推送部署。',
             f'settings SHA256：{settings_hash}。本設計另存.qa/stage4_9a-frozen-report.md並校驗，之後不依結果改。', '',
             '目前：設計已凍結，階段1–4與verify尚未執行。']
    report = '\n'.join(lines) + '\n'
    source_hashes = {str(path.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in (ROOT / 'src').rglob('*') if path.is_file()}
    registration = json.loads(Path(str(PREFIX) + 'registration.json').read_text(encoding='utf-8'))
    inputs = {'src': source_hashes, 'references': {r['path']: r['sha256'] for r in registration['registration']}}
    for name, value in [('settings.json', text), ('frozen-report.md', report),
                        ('frozen.json', json.dumps({'settings_sha256': settings_hash, 'report_sha256': hashlib.sha256(report.encode()).hexdigest(), 'inputs': inputs}, ensure_ascii=False, indent=2) + '\n')]:
        with Path(str(PREFIX) + name).open('x', encoding='utf-8', newline='') as stream:
            stream.write(value)
    with (ROOT / 'STAGE4_9A_REPORT.md').open('x', encoding='utf-8', newline='') as stream:
        stream.write(report)
    print(settings_hash)


if __name__ == '__main__':
    main()
