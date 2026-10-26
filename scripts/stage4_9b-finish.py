"""One-shot full verification and report from saved v2 checkpoints only."""
import hashlib
import functools
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'.qa'
PREFIX='stage4_9b-v2-'


def load_module():
    spec=importlib.util.spec_from_file_location('audit',ROOT/'scripts/stage4_9b-run.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.guard()
    return module


def read(name):
    return json.loads((QA/(PREFIX+name+'.json')).read_text(encoding='utf-8'))


def save(name,value):
    path=QA/(PREFIX+name+'.json')
    temporary=path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='')
    temporary.replace(path)


def verify():
    audit=load_module();read('stage4')
    marker=QA/(PREFIX+'verify-start.json')
    with marker.open('x',encoding='utf-8') as stream:
        json.dump({'started':time.time(),'command':'pnpm run verify','runs':1},stream)
    start=time.monotonic()
    with (QA/(PREFIX+'verify.log')).open('w',encoding='utf-8') as stream:
        result=subprocess.run([shutil.which('pnpm.cmd'),'run','verify'],cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT,text=True)
    names=['verification-summary.json','v2-original-tests.json','scientific-tests.json','worker-tests.json']
    for name in names:
        assert (QA/name).stat().st_mtime>=json.loads(marker.read_text())['started'],'stale verify output: '+name
        shutil.copyfile(QA/name,QA/(PREFIX+name))
    suites={}
    for name in names[1:]:
        rows=json.loads((QA/name).read_text(encoding='utf-8'))
        suites[name]={'passed':sum(r['passed'] for r in rows),'total':len(rows),'failures':[r for r in rows if not r['passed']]}
    previous=json.loads((QA/'stage4_9a-scientific-tests.json').read_text(encoding='utf-8'))
    expected=[r for r in previous if not r['passed']]
    save('verify',{'elapsed_seconds':time.monotonic()-start,'exit_code':result.returncode,'suites':suites,
                   'failures_exactly_unchanged':suites['scientific-tests.json']['failures']==expected,'expected_failures':expected,
                   'commands':json.loads((QA/'verification-summary.json').read_text(encoding='utf-8'))['commands']})
    audit.guard();print(json.dumps(read('verify'),ensure_ascii=True))


def num(value):
    return 'NA' if value is None else f'{value:.4g}'


def tagged(value,component,floor):
    if value is None:return 'NA'
    return num(value)+('*' if component in floor and abs(value)<floor[component] else '')


def metrics(value,component,floor,position=False):
    if not value:return 'NA'
    return tagged(value['maxAbs'],component,floor)+(('@'+num(value['at_nm'])) if position else '')+'/'+tagged(value['rms'],component,floor)


def annotation_index(audit,a3,a4):
    """Presentation annotations, including point errors, without changing any saved result."""
    # Completed checkpoints are immutable; avoid reparsing stage0 for every point label.
    audit.read=functools.cache(audit.read)
    names={'stage1','stage2','stage3','stage4'}|set(a3['keys'])|{r['key'] for r in a4['records']}|{r['key'] for r in a4['automatic']}
    names.update(p.name[len(PREFIX):-5] for p in QA.glob(PREFIX+'s2-*.json'))
    index=[]
    scalar={'psiError':'psi','deltaError':'delta','nError':'n','kError':'k','nSigma':'n','kSigma':'k','thicknessError':'thickness','thickness_stdError':'thickness'}
    edge=audit.S['hc_eVnm']/6.5
    for name in sorted(names):
        raw=QA/(PREFIX+name+'.json');data=read(name);entries=[];extrap=[]
        def visit(value,path='$',component=None):
            if isinstance(value,dict):
                if isinstance(value.get('wavelength'),(int,float)) and value['wavelength']<edge:
                    extrap.append({'path':path,'label':'外推','wavelength':value['wavelength']})
                if 'band'in value and isinstance(value['band'],list) and value['band'][0]<edge:
                    extrap.append({'path':path,'label':'包含外推' if value['band'][1]>edge else '外推','band':value['band']})
                for key,item in value.items():
                    if key=='annotations':continue
                    c=scalar.get(key) or (component if key in ['maxAbs','rms','difference'] else None)
                    if c and isinstance(item,(int,float)) and not isinstance(item,bool):
                        entries.append({'path':path+'.'+key,**audit.annotations(item,c)})
                    child_component=key if key in ['n','k','psi','delta','epsilon','thickness'] else key.split('_')[0] if key in ['n_maxAbs','n_rms','k_maxAbs','k_rms'] else None
                    visit(item,path+'.'+key,child_component)
            elif isinstance(value,list):
                for i,item in enumerate(value):visit(item,path+'['+str(i)+']',component)
        visit(data)
        index.append({'file':str(raw.relative_to(ROOT)),'sha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'annotations':entries,'extrapolation':extrap})
    save('annotation-index',{'policy':'frozen matching-unit interp_floor, strict<; thickness NA; no raw checkpoint rewritten','files':index})


def report():
    audit=load_module()
    a0,a1,a2,a3,a4,v=[read('stage'+str(i)) for i in range(5)]+[read('verify')]
    floor=a0['interp_floor'];frozen=read('frozen')
    prior_epsilon=json.loads((QA/'stage4_9b-v1-native-epsilon-interpolation.json').read_text(encoding='utf-8'))
    for name in ['verification-summary.json','v2-original-tests.json','scientific-tests.json','worker-tests.json']:
        assert (QA/name).read_bytes()==(QA/(PREFIX+name)).read_bytes()
        assert (QA/name).stat().st_mtime>=read('verify-start')['started']
    registration=json.loads((QA/'stage4_9b-v1-registration.json').read_text(encoding='utf-8'))
    lines=['# Stage 4.9b：Si 基板候選表與短波段貢獻診斷','',
           '基準9f4d2ae／v2.2-integration；僅新增診斷／報告；src、正式容差、迭代上限、既有斷言及部署設定均未改；離線指定venv、pyElli0.23.1。',
           '原檔唯讀：`'+audit.S['si_final']['path']+'`；'+str(registration['bytes'])+'bytes；SHA256 `'+registration['sha256']+'`；儲存庫外、未追蹤／複製／加入Git。',
           '檔頭Herzinger等JAP83,3323(1998)；文字eV/ε₁/ε₂；'+str(registration['rows'])+'列；E .2–6.6eV，λ187.854846–6199.20992nm；.01eV×630區間、6.5以上.02eV×5。',
           '原生ε₂往低E單調不增並終於零：3.42→.2eV共323列；E<1的80列原本已為零，僅記憶體強制零；論文量測.75–6.5eV，λ<190.744921nm標外推。',
           'v2 settings SHA256 `'+frozen['settings_sha256']+'`；設計原稿SHA256 `'+frozen['report_sha256']+'`；以`.qa/stage4_9b-v2-frozen.json`為準，原稿為v2-frozen-report.md；舊frozen.json保留v1紀錄。',
           'v1設定SHA `'+frozen['previous']['settings_sha256']+'`／設計SHA `'+frozen['previous']['report_sha256']+'`，完整封存`.qa/stage4_9b-v1-*`；重凍結依使用者明確修訂。',
           '方法／原始輸出均見`.qa/stage4_9b-v2-*`；不保存文獻原表或Si稠密數值，跨程序只用RAM stdin。',
           '設計：①[190,250)、②[250,400)、③[400,900]、④[190,207)、⑤[207,250)；另單列外推190nm，表中五段依此順序，完整位置／逐點／外推子表在JSON。',
           'C0現行31點n/k–λ線性；C1 SiF5nm、C2 SiF1nm皆ε–E PCHIP；C3 Si-final→Aspnes→Green2008，ε餘弦混合後PCHIP取1nm。',
           'C3規格修訂：混合206.6–212及822–826.6nm，各自完整餘弦；混合寬度不再都是10nm，為5.4／4.6nm，不對文獻表數值外推。',
           '膜／種子／邊界等完整於settings：Cauchy1.52/.0045/.00008/0；Gaussian2.5/1.8/3.5/.45；20/60/100nm、AOI65/70/75、σ=.03°；種子60001+100t+10f+d。',
           '3b/4匹配族真值起點，原LM50次/ftol1e-5/既有xtol/gtol，d1–200、registry材料邊界；正式TMM／statistics／Automatic未改；後者保留原自由形式邊界。',
           '原門檻不變：角差>.03°、膜n max>.01、abs厚差>.1nm只標記；.003°閘門經使用者修訂為只報告、不停止。',
           '星號*＝嚴格小於對應interp_floor：「無法與內插不確定度區分」；JSON同時標max/RMS，膜厚一律NA／無法判定，不套其他量的floor。',
           '角度結論還須以線性/PCHIP Ψ.0083°、Δ.0283°為下限（與.03°雜訊同量級）；n/k floor只為基板敏感度尺度，不是已校準的膜不確定度。','',
           '|階段0線性/PCHIP或PCHIP/cs|最大Ψ差°@nm/AOI|最大圓周Δ差°@nm/AOI|', '|---|---|---|']
    for label,key in [('線性/PCHIP','linear_pchip'),('PCHIP/cs','pchip_cs')]:
        row=a0[key]['global']
        lines.append('|'+label+'|'+'|'.join(num(row[c]['maxAbs'])+'@'+num(row[c]['at_nm'])+'/'+num(row[c]['aoi']) for c in ['psi','delta'])+'|')
    dense=a0['dense_stats']
    lines+=['','interp_floor：n '+num(floor['n'])+'@'+num(dense['n']['at_nm'])+'nm、k '+num(floor['k'])+'@'+num(dense['k']['at_nm'])+'nm、ε '+num(floor['epsilon'])+'@'+num(dense['epsilon']['at_nm'])+'nm、Ψ '+num(floor['psi'])+'°、Δ '+num(floor['delta'])+'°；ε₁差 '+num(dense['epsilon1']['maxAbs'])+'@'+num(dense['epsilon1']['at_nm'])+'nm、ε₂差 '+num(dense['epsilon2']['maxAbs'])+'@'+num(dense['epsilon2']['at_nm'])+'nm；v1線性/PCHIP ε₁/ε₂ max@eV/RMS沿用：'+'；'.join(num(prior_epsilon[c]['maxAbs'])+'@'+num(prior_epsilon[c]['at_eV'])+'/'+num(prior_epsilon[c]['rms']) for c in ['epsilon1','epsilon2'])+'；原生細分／外推角差在stage0.json。',
            '補列4.9a既存250–400配對：最大差@nm（讀檔、未重算），n線性→PCHIP；k線性→PCHIP：','',
            '|配對|n|k|','|---|---|---|']
    old=json.loads((QA/'stage4_9a-pchip-reference-check.json').read_text(encoding='utf-8'))
    for row in old['pairs']:
        lines.append('|'+str(row['pair'])+' '+ '/'.join(row['entries'])+'|'+'|'.join('→'.join(num(row[c][m]['max_abs'])+'@'+num(row[c][m]['wavelength_nm']) for m in ['linear','pchip']) for c in ['n','k'])+'|')
    lines+=['','階段1：各來源對SiF-dense，參考n/k對λ PCHIP、各自有效域；下表每段n最大@位置/RMS,k最大@位置/RMS；Franta25C為模型輸出。','',
            '|來源|①；②；③；④；⑤ n,k|','|---|---|']
    for row in a1['comparisons']:
        lines.append('|'+row['id']+'|'+'; '.join(metrics(r['n'],'n',floor,True)+','+metrics(r['k'],'k',floor,True) for r in row['regions'][:5])+'|')
    lines.append('|floor_lit|'+'; '.join('/'.join(num(r['n'][m]) for m in ['maxAbs','rms'])+','+'/'.join(num(r['k'][m]) for m in ['maxAbs','rms']) if r['n'] and r['k'] else 'NA' for r in a1['floor_lit'][:5])+'|')
    ratios=a1['comparisons'][0]['regions']
    lines+=['','C0/floor_lit各段n max/RMS倍率,k max/RMS倍率：'+'；'.join('/'.join(num(r['ratios_to_floor_lit'][c][m]) for m in ['maxAbs','rms'])+','+'/'.join(num(r['ratios_to_floor_lit']['k'][m]) for m in ['maxAbs','rms']) for r in ratios[:5] for c in ['n'])+'；僅為表差尺度，不下現行表正誤結論。','',
            '階段2：55組完整n/k五段max/RMS及前向角差在stage2.json／s2-*.json；下列為各方法達到兩角全域嚴格<.03°的最稀已測格距，NA代表無；尾端補點不等距另註於JSON。','',
            '|方法|λ最稀nm|E最稀eV|','|---|---|---|']
    for method in audit.S['stage2_methods']:
        vals=[next(r['coarsest_tested'] for r in a2['coarsest_tested'] if r['method']==method and r['family']==family) for family in ['lambda','energy']]
        lines.append('|'+method+'|'+'|'.join(num(x) for x in vals)+'|')
    lines+=['','階段2僅報告、不選用；λ10nm取樣與前向10nm評分格點重合，通過不代表格點間角差<.03°；1nm曲線誤差另列JSON，不能把低於不確定度下限的差當成已證明更準。','',
            '階段3：148次（原144+SiF-cs Cauchy60的4次）；Si-final×C1/C2同源自洽格排除彙總，cs另列不納主要彙總；每段角度為Ψmax/RMS,Δmax/RMS，膜誤差為n max/RMS,k max/RMS。','',
            '|候選/非自洽資料集數|角差①；②；③；④；⑤|膜n,k誤差①；②；③；④；⑤|厚差max/RMS nm|','|---|---|---|---|']
    for row in a3['aggregates']:
        lines.append('|'+row['candidate']+'/'+str(row['datasets'])+'|'+'; '.join(metrics(r['psi'],'psi',floor)+','+metrics(r['delta'],'delta',floor) for r in row['regions'][:5])+'|'+'; '.join(metrics(r['n'],'n',floor)+','+metrics(r['k'],'k',floor) for r in row['regions'][:5])+'|'+num(row['regions'][2]['thickness']['maxAbs'])+'/'+num(row['regions'][2]['thickness']['rms'])+'|')
    lines+=['','各候選各段對相同cohort C0的全部倍率、逐格有號厚差、flags與floor_lit並列資料見stage3.json及s3-*.json；不判候選最好。',
            '緊湊表足夠（僅相對floor_lit10%的基板n/k表示精度）：'+str(a3['compact_sufficient_substrate_nk_only'])+'；逐段差與floor_lit見compact_comparison，其差是否小於interp_floor另列annotation-index；不等同已證明準確，階段2角差不納此標記。','',
            '|單一膜／單一厚度敏感度樣本：Cauchy60|d_fit(cs)−d_fit(PCHIP)，有號nm|','|---|---|']
    for row in a3['thickness_sensitivity']:
        lines.append('|'+row['candidate']+'|'+num(row['signed_cs_minus_pchip_nm'])+'|')
    lines+=['','這4筆不是膜厚interp_floor，不用來替其他格貼標籤。','',
            '階段4：真值Si-final、兩膜60nm、seed61001/61002；A/B/C/D實際範圍見各列；n/k誤差五段max/RMS，σn/σk為③段有限曲線σ的RMS，完整五段及參數stdError在stage4.json。','',
            '|膜/擬合Si/範圍|厚差nm；厚stdError；相對A倍率|n,k誤差①；②；③；④；⑤|σn/σk③|','|---|---|---|---|']
    for row in a4['records']:
        raw=read(row['key']);domain=raw['meta']['domain']
        lines.append('|'+row['film']+'/'+row['candidate']+'/'+row['label']+str(domain)+'|'+num(row['errors']['thicknessError'])+';'+num(row['thickness_stdError'])+';'+num(row['thickness_stdError_relative_A'])+'|'+'; '.join(metrics(r['n'],'n',floor)+','+metrics(r['k'],'k',floor) for r in row['errors']['regions'][:5])+'|'+'/'.join(tagged(row['uncertainty'][2][c]['rms'],c,floor) if row['uncertainty'][2][c] else 'NA' for c in ['n','k'])+'|')
    lines+=['','Aspnes/Jellison A/B相同，不能比較207nm以下貢獻，只有Si-final自洽組能呈現；24格實際20次獨立局部擬合，4格精確共用快取；σ缺失／非可識別保留NA。','',
            '|正式Automatic：Gaussian60|膜n,k五段max/RMS|有號厚差nm|來源/節點/s；λN/λK|','|---|---|---|---|']
    for row in a4['automatic']:
        selected=row['refinement'].get('selectedSetting',{})
        actual=row['actual_model_setting']
        lines.append('|'+row['case']['truth']+'/'+row['case']['candidate']+'|'+'; '.join(metrics(r['n'],'n',floor)+','+metrics(r['k'],'k',floor) for r in row['errors']['regions'][:5])+'|'+num(row['errors']['thicknessError'])+'|'+row['origin']+'/'+num(actual['count'])+'/'+str(selected.get('scale','NA'))+';'+num(actual['lambdaN'])+'/'+num(actual['lambdaK'])+'|')
    jobs=[read(key) for key in a3['keys']]
    n_flags=sum(any(x is True for x in j['flags']['n']) for j in jobs)
    d_flags=sum(j['flags']['thickness'] for j in jobs)
    f_flags=sum(any(x is True for x in j['flags']['forward']) for j in jobs)
    a4n=sum(any(x is True for x in r['flags']['n']) for r in a4['records'])
    a4d=sum(r['flags']['thickness'] for r in a4['records'])
    lines+=['',f'標記總數：階段3角度超標{f_flags}/148、膜n{n_flags}/148、厚差{d_flags}/148（含自洽／敏感度格）；階段4膜n{a4n}/24、厚差{a4d}/24；完整同量綱標籤與外推索引在annotation-index.json，原始檢查點不改；厚度floor均NA。',
            'verify僅一次：'+'；'.join(name+' '+str(r['passed'])+'/'+str(r['total']) for name,r in v['suites'].items())+'；typecheck/build結果見verify.json。',
            '對4.9a兩項既有失敗（'+'；'.join(r['name'] for r in v['expected_failures'])+'）：名稱與完整內容'+('完全相同，無新增。' if v['failures_exactly_unchanged'] else '有差異，須單獨回報，見verify.json。'),
            '執行器實測牆鐘秒：'+ '；'.join(str(i)+'='+num(x['elapsed_seconds']) for i,x in enumerate([a0,a1,a2,a3,a4]))+'；verify='+num(v['elapsed_seconds'])+'；合計='+num(sum(x['elapsed_seconds'] for x in [a0,a1,a2,a3,a4,v]))+'（不含暫停、監測等待與報告整理）；逐作業毫秒在檢查點。',
            '暫停造成重算範圍0：從已存階段0接續；v1→v2階段0重算為使用者明確授權；未保存stage0的hypot實作差異及stage2首組NumPy布林序列化曾重算，未改設計，已保存結果重跑0。',
            '限制：來源差異與內插敏感度不是真實準確度信賴區間；190nm為模型外推；單一Cauchy60膜厚樣本不能推廣；statistics沿用殘差縮放，非自洽stdError混有模型失配尺度；Cauchy k固定0不是吸收精度驗證；不以真實樣品調參。',
            '新增檔案僅stage4_9b-*診斷及本報告；補充規劃與MAT不納commit；src／部署未動，不部署、不推送。']
    # Merge only introductory paragraphs; retain blank lines around every table.
    for index in [8,6,4,2]:
        lines[index:index+2]=[' '.join(lines[index:index+2])]
    text='\n'.join(lines)+'\n'
    count=len(text.splitlines())
    assert count<=120,'report lines='+str(count)
    annotation_index(audit,a3,a4)
    audit.guard()
    (ROOT/'STAGE4_9B_REPORT.md').write_text(text,encoding='utf-8',newline='')
    save('report-metadata',{'lines':count,'sha256':hashlib.sha256(text.encode()).hexdigest(),'settings_sha256':frozen['settings_sha256'],'pause_caused_rerun_scope':'none','saved_results_rerun':0})
    print(json.dumps({'report_lines':count}))


if __name__=='__main__':
    {'verify':verify,'report':report}[sys.argv[1]]()
