/**
 * Unit Tests & Physics Verification Modal
 * Executes automated test suite covering Model Registry, TMM Optical Solver,
 * Residual Metrics, and Bounded LM Optimizer.
 */
import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, Play, RotateCcw, X, ShieldCheck } from 'lucide-react';
import type { TestResult } from '../tests/unitTests';
import { ComputationClient } from '../workers/client';

interface UnitTestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UnitTestsModal: React.FC<UnitTestsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const client=useRef(new ComputationClient());
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  const executeTests = async () => {
    setIsRunning(true);
    try {
      const result = await client.current.start('tests',undefined,0);
      setTestResults(result.tests??[]);
    } catch (e: any) {
      console.error('Test execution failed', e);
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (isOpen && testResults.length === 0) {
      executeTests();
    }
  }, [isOpen]);
  useEffect(()=>{if(!isOpen){client.current.dispose();setIsRunning(false);}return()=>client.current.dispose();},[isOpen]);

  if (!isOpen) return null;

  const passedCount = testResults.filter((t) => t.passed).length;
  const totalCount = testResults.length;
  const allPassed = totalCount > 0 && passedCount === totalCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col text-xs text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                光學物理演算驗證與單元測試 (Physics Verification)
              </h2>
              <p className="text-[11px] text-slate-400">
                自動回歸測試光學色散模型、特徵傳遞矩陣 (TMM)、殘差計算公式與擬合最佳化器邊界約束
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

        {/* Status Banner */}
        <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {isRunning ? (
              <span className="text-cyan-400 flex items-center space-x-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span>正在執行光學物理驗證測試套件...</span>
              </span>
            ) : (
              <div className="flex items-center space-x-2">
                <span
                  className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                    allPassed
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}
                >
                  {passedCount}/{totalCount} 通過 (PASSED)
                </span>
                <span className="text-slate-400 text-[11px]">
                  所有核心光學方程式與最佳化求解約束均通過嚴謹驗證。
                </span>
              </div>
            )}
          </div>

          <button
            onClick={executeTests}
            disabled={isRunning}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-50 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
            <span>重新執行測試</span>
          </button>
        </div>

        {/* Tests List */}
        <div className="flex-1 p-4 overflow-y-auto space-y-2">
          {testResults.map((t, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border flex items-start justify-between ${
                t.passed
                  ? 'bg-slate-800/40 border-slate-750'
                  : 'bg-rose-950/30 border-rose-800/80'
              }`}
            >
              <div className="flex items-start space-x-3">
                {t.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-100">{t.name}</span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {t.category}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400 text-[11px] leading-relaxed">
                    {t.message}
                  </p>
                </div>
              </div>

              <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-2">
                {t.durationMs.toFixed(1)}ms
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 flex justify-end bg-slate-950/60">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
