/**
 * CSV Import & Column Mapping Modal
 * Allows uploading spectroscopic CSV data, mapping columns, selecting delimiters,
 * overriding fixed angles of incidence, and previewing mapped data.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  X,
  ArrowRight,
} from 'lucide-react';
import {
  inspectCsv,
  convertRowsToPoints,
  CsvColumnMapping,
  ParseCsvResult,
} from '../data/csvParser';
import { ExperimentDataset } from '../types/ellipsometry';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (dataset: ExperimentDataset) => void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const readSequence=useRef(0);
  const [csvRawText, setCsvRawText] = useState<string>('');
  const [filename, setFilename] = useState<string>('measurement_data.csv');
  const [inspectResult, setInspectResult] = useState<ParseCsvResult | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({
    wavelengthCol: 0,
    psiCol: 1,
    deltaCol: 2,
    sigmaPsiCol: -1,
    sigmaDeltaCol: -1,
    deltaConvention: 'standard',
    aoiCol: -1,
    fixedAoi: 70.0,
    wavelengthUnit: 'nm',
    hasHeader: true,
  });
  const [useFixedAngle, setUseFixedAngle] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sample default CSVs for demonstration
  const loadSampleCsv = () => {
    const sample = `Wavelength(nm),AOI(deg),Psi(deg),Delta(deg)
350,70,36.21,114.52
375,70,34.80,118.23
400,70,33.52,122.10
425,70,32.41,126.15
450,70,31.42,130.32
475,70,30.55,134.61
500,70,29.77,138.98
525,70,29.07,143.42
550,70,28.45,147.91
575,70,27.90,152.44
600,70,27.41,157.00
625,70,26.97,161.57
650,70,26.58,166.14
675,70,26.24,170.69
700,70,25.94,175.22
725,70,25.68,179.72
750,70,25.46,184.18
775,70,25.27,188.60
800,70,25.11,192.97`;

    setCsvRawText(sample);
    setFilename('sample_sio2_single_70deg.csv');
  };

  const loadMultiAoiSampleCsv = () => {
    const sample = `Wavelength(nm),AOI(deg),Psi(deg),Delta(deg)
400,65,30.82,132.41
450,65,28.45,140.23
500,65,26.71,148.82
550,65,25.32,157.94
600,65,24.18,167.31
650,65,23.23,176.80
700,65,22.42,186.29
750,65,21.73,195.72
800,65,21.14,205.03
400,70,33.52,122.10
450,70,31.42,130.32
500,70,29.77,138.98
550,70,28.45,147.91
600,70,27.41,157.00
650,70,26.58,166.14
700,70,25.94,175.22
750,70,25.46,184.18
800,70,25.11,192.97
400,75,37.15,108.64
450,75,35.21,117.82
500,75,33.68,127.35
550,75,32.45,137.12
600,75,31.44,146.99
650,75,30.61,156.88
700,75,29.93,166.72
750,75,29.37,176.47
800,75,28.91,186.09`;

    setCsvRawText(sample);
    setFilename('sample_sio2_multi_aoi_65_70_75deg.csv');
  };

  useEffect(() => {
    if (csvRawText) {
      const res = inspectCsv(csvRawText);
      setInspectResult(res);
      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setErrorMsg(null);
        setMapping(res.suggestedMapping);
        setUseFixedAngle(res.suggestedMapping.aoiCol === -1);
      }
    } else {
      setInspectResult(null);
    }
  }, [csvRawText]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFilename(file.name);
    const sequence=++readSequence.current;
    const reader = new FileReader();
    reader.onerror=()=>setErrorMsg('無法讀取 CSV 檔案');
    reader.onload = (event) => {
      if(sequence!==readSequence.current)return;
      const content = event.target?.result as string;
      setCsvRawText(content);
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = () => {
    if (!inspectResult || inspectResult.rawRows.length === 0) {
      setErrorMsg('尚未載入任何數據。');
      return;
    }

    const effectiveMapping: CsvColumnMapping = {
      ...mapping,
      aoiCol: useFixedAngle ? -1 : mapping.aoiCol,
    };

    const res = convertRowsToPoints(inspectResult.rawRows, effectiveMapping);
    if (res.error) {
      setErrorMsg(res.error);
      return;
    }

    if (res.points.length === 0) {
      setErrorMsg('解析出 0 筆數據點，請檢查欄位映射是否正確。');
      return;
    }

    const minW = Math.min(...res.points.map((p) => p.wavelength));
    const maxW = Math.max(...res.points.map((p) => p.wavelength));

    const dataset: ExperimentDataset = {
      deltaConvention: effectiveMapping.deltaConvention,
      filename,
      importedAt: new Date().toISOString(),
      points: res.points,
      angles: res.distinctAngles,
      wavelengthMin: minW,
      wavelengthMax: maxW,
    };

    onImportSuccess(dataset);
    setCsvRawText('');setInspectResult(null);
    onClose();
  };

  return (
    <div className="ui1-surface ui1-modal fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col text-xs text-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-2">
            <FileSpreadsheet className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                匯入光譜橢圓儀實驗數據 (CSV / TXT)
              </h2>
              <p className="text-[11px] text-slate-400">
                將原始光譜表格欄位映射至波長 (λ)、入射角 (AOI)、Ψ (Psi) 與 Δ (Delta)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* File Picker or Paste */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <label className="flex-1 w-full border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-lg p-4 flex items-center justify-center space-x-3 cursor-pointer bg-slate-800/40 hover:bg-slate-800/80 transition-all">
              <Upload className="w-5 h-5 text-cyan-400" />
              <div>
                <span className="font-medium text-slate-200">
                  {filename !== 'measurement_data.csv' ? filename : '選取本機 CSV 或 TXT 數據檔案'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  點擊瀏覽電腦中的實驗數據檔案
                </span>
              </div>
              <input
                type="file"
                accept=".csv,.txt,.dat"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                onClick={loadSampleCsv}
                className="px-3 py-2 border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors text-left"
              >
                <div className="font-semibold text-slate-100">單角度 (70°) 範例</div>
                <div className="text-[10px] text-slate-400">標準 SiO₂ 光譜</div>
              </button>
              <button
                onClick={loadMultiAoiSampleCsv}
                className="px-3 py-2 border border-cyan-700/80 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 rounded-lg font-medium transition-colors text-left shadow-xs"
              >
                <div className="font-semibold text-cyan-300 flex items-center space-x-1">
                  <span>多角度 (65°/70°/75°)</span>
                  <span className="text-[9px] bg-cyan-900 text-cyan-200 px-1 rounded">Multi-AOI</span>
                </div>
                <div className="text-[10px] text-cyan-400/80">三角度聯立光譜數據</div>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Column Mapping Section */}
          {inspectResult && inspectResult.headers.length > 0 && (
            <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700 space-y-3">
              <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                欄位映射與單位設定 (Column Mapping)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {/* Wavelength Column */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    波長欄位 (λ)
                  </label>
                  <select
                    value={mapping.wavelengthCol}
                    onChange={(e) =>
                      setMapping({ ...mapping, wavelengthCol: parseInt(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500"
                  >
                    {inspectResult.headers.map((h, i) => (
                      <option key={i} value={i}>
                        第 {i + 1} 欄: {h}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 flex items-center space-x-2 text-[11px] text-slate-400">
                    <span>單位:</span>
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="wl_unit"
                        checked={mapping.wavelengthUnit === 'nm'}
                        onChange={() => setMapping({ ...mapping, wavelengthUnit: 'nm' })}
                        className="mr-1 text-cyan-500"
                      />
                      nm
                    </label>
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="wl_unit"
                        checked={mapping.wavelengthUnit === 'um'}
                        onChange={() => setMapping({ ...mapping, wavelengthUnit: 'um' })}
                        className="mr-1 text-cyan-500"
                      />
                      μm
                    </label>
                  </div>
                </div>

                {/* Psi Column */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Ψ (Psi 振幅角)</label>
                  <select
                    value={mapping.psiCol}
                    onChange={(e) =>
                      setMapping({ ...mapping, psiCol: parseInt(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500"
                  >
                    {inspectResult.headers.map((h, i) => (
                      <option key={i} value={i}>
                        第 {i + 1} 欄: {h}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    角度單位 [0° - 90°]
                  </span>
                </div>

                {/* Delta Column */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Δ (Delta 相位差)</label>
                  <select
                    value={mapping.deltaCol}
                    onChange={(e) =>
                      setMapping({ ...mapping, deltaCol: parseInt(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500"
                  >
                    {inspectResult.headers.map((h, i) => (
                      <option key={i} value={i}>
                        第 {i + 1} 欄: {h}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    角度單位 [0° - 360°]
                  </span>
                </div>

                {/* Angle of Incidence */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-400 font-medium">入射角 (AOI)</label>
                    <label className="text-[11px] text-cyan-400 cursor-pointer flex items-center space-x-1">
                      <input
                        type="checkbox"
                        checked={useFixedAngle}
                        onChange={(e) => setUseFixedAngle(e.target.checked)}
                        className="rounded border-slate-700 text-cyan-600 focus:ring-0"
                      />
                      <span>固定角度</span>
                    </label>
                  </div>

                  {useFixedAngle ? (
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="89"
                        value={mapping.fixedAoi}
                        onChange={(e) =>
                          setMapping({
                            ...mapping,
                            fixedAoi: parseFloat(e.target.value) || 70.0,
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 font-mono text-xs"
                      />
                      <span className="text-slate-400 font-mono">度 (deg)</span>
                    </div>
                  ) : (
                    <select
                      value={mapping.aoiCol >= 0 ? mapping.aoiCol : 0}
                      onChange={(e) =>
                        setMapping({ ...mapping, aoiCol: parseInt(e.target.value) })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500"
                    >
                      {inspectResult.headers.map((h, i) => (
                        <option key={i} value={i}>
                          第 {i + 1} 欄: {h}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['sigmaPsiCol', 'sigmaDeltaCol'] as const).map((key, i) => (
                  <label key={key} className="text-sky-300">
                    {i === 0 ? 'σΨ 欄位' : 'σΔ 欄位'}
                    <select aria-label={i === 0 ? 'σΨ 欄位' : 'σΔ 欄位'} value={mapping[key]}
                      onChange={e => setMapping({ ...mapping, [key]: Number(e.target.value) })}
                      className="block w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5">
                      <option value={-1}>無</option>
                      {inspectResult.headers.map((h, i) => <option key={i} value={i}>第 {i + 1} 欄: {h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <fieldset className="space-y-2">
                <legend className="font-medium mb-1">Δ 慣例</legend>
                <label className="block"><input type="radio" name="delta-convention" className="mr-2"
                  checked={mapping.deltaConvention === 'standard'} onChange={() => setMapping({ ...mapping, deltaConvention: 'standard' })}/>
                  標準（Woollam / Horiba / Fujiwara）</label>
                <label className="block"><input type="radio" name="delta-convention" className="mr-2"
                  checked={mapping.deltaConvention === 'reversed'} onChange={() => setMapping({ ...mapping, deltaConvention: 'reversed' })}/>
                  反向（Δ' = 360° − Δ）— 用於慣例相反的儀器或舊版軟體輸出</label>
              </fieldset>

              {/* Data Preview Table */}
              <div className="pt-2">
                <span className="text-[11px] text-slate-400 block mb-1 font-semibold">
                  原始檔案內容預覽 (前 6 列):
                </span>
                <div className="overflow-x-auto rounded border border-slate-750 bg-slate-950">
                  <table className="w-full text-left font-mono text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                        {inspectResult.headers.map((h, colIdx) => {
                          let badge = null;
                          if (colIdx === mapping.wavelengthCol)
                            badge = <span className="text-cyan-400">(λ)</span>;
                          if (colIdx === mapping.psiCol)
                            badge = <span className="text-amber-400">(Ψ)</span>;
                          if (colIdx === mapping.deltaCol)
                            badge = <span className="text-emerald-400">(Δ)</span>;
                          if (colIdx === mapping.sigmaPsiCol)
                            badge = <span className="text-sky-300">(σΨ)</span>;
                          if (colIdx === mapping.sigmaDeltaCol)
                            badge = <span className="text-rose-300">(σΔ)</span>;
                          if (!useFixedAngle && colIdx === mapping.aoiCol)
                            badge = <span className="text-purple-400">(AOI)</span>;

                          return (
                            <th key={colIdx} className="p-2 whitespace-nowrap">
                              {h} {badge}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {inspectResult.rawRows
                        .slice(mapping.hasHeader ? 1 : 0, mapping.hasHeader ? 7 : 6)
                        .map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-800/30">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="p-2 text-slate-300">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="text-[11px] text-slate-400">
            {inspectResult && (
              <span>
                偵測到共 {Math.max(0, inspectResult.rawRows.length - (mapping.hasHeader ? 1 : 0))}{' '}
                列有效數據
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              取消
            </button>
            <button
              onClick={handleExecuteImport}
              disabled={!inspectResult || inspectResult.rawRows.length === 0}
              className="px-5 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold flex items-center space-x-1.5 shadow"
            >
              <span>確認並匯入光譜數據</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
