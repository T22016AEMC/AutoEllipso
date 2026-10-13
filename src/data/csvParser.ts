/**
 * Robust CSV/Data Parser for Spectroscopic Ellipsometry
 * Supports multiple delimiters (comma, semicolon, tab, space), automatic column detection,
 * custom column mapping, and fixed angle of incidence fallback.
 */
import { EllipsometryDataPoint } from '../types/ellipsometry';

export interface CsvColumnMapping {
  wavelengthCol: number;
  psiCol: number;
  deltaCol: number;
  aoiCol: number; // -1 if using fixed angle
  fixedAoi: number;
  wavelengthUnit: 'nm' | 'um';
  hasHeader: boolean;
}

export interface ParseCsvResult {
  headers: string[];
  rawRows: string[][];
  suggestedMapping: CsvColumnMapping;
  distinctAngles: number[];
  points: EllipsometryDataPoint[];
  error?: string;
}

/**
 * Detect delimiter from text sample
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const commas = (sample.match(/,/g) || []).length;
  const semicolons = (sample.match(/;/g) || []).length;
  const tabs = (sample.match(/\t/g) || []).length;

  if (tabs > commas && tabs > semicolons) return '\t';
  if (semicolons > commas && semicolons > tabs) return ';';
  return ',';
}

/**
 * Split CSV line respecting quoted fields
 */
function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Heuristically deduce column mapping from header names
 */
function deduceColumnMapping(headers: string[]): CsvColumnMapping {
  let wavelengthCol = 0;
  let psiCol = 1;
  let deltaCol = 2;
  let aoiCol = -1;
  let wavelengthUnit: 'nm' | 'um' = 'nm';

  headers.forEach((h, idx) => {
    const lower = h.toLowerCase();
    if (lower.includes('wave') || lower.includes('lambda') || lower.includes('wl') || lower.includes('nm') || lower.includes('um')) {
      wavelengthCol = idx;
      if (lower.includes('um') || lower.includes('µm') || lower.includes('mic')) {
        wavelengthUnit = 'um';
      }
    } else if (lower.includes('psi') || lower === 'p' || lower.includes('ψ') || lower.includes('tanpsi')) {
      psiCol = idx;
    } else if (lower.includes('delta') || lower === 'd' || lower.includes('δ') || lower.includes('del')) {
      deltaCol = idx;
    } else if (lower.includes('aoi') || lower.includes('angle') || lower.includes('theta') || lower.includes('deg')) {
      aoiCol = idx;
    }
  });

  return {
    wavelengthCol,
    psiCol,
    deltaCol,
    aoiCol,
    fixedAoi: 70.0,
    wavelengthUnit,
    hasHeader: true,
  };
}

/**
 * Parse raw CSV text and provide initial preview and mapping
 */
export function inspectCsv(csvContent: string): ParseCsvResult {
  const trimmed = csvContent.trim();
  if (!trimmed) {
    return {
      headers: [],
      rawRows: [],
      suggestedMapping: {
        wavelengthCol: 0,
        psiCol: 1,
        deltaCol: 2,
        aoiCol: -1,
        fixedAoi: 70.0,
        wavelengthUnit: 'nm',
        hasHeader: true,
      },
      distinctAngles: [],
      points: [],
      error: 'CSV content is empty.',
    };
  }

  const delimiter = detectDelimiter(trimmed);
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return {
      headers: [],
      rawRows: [],
      suggestedMapping: {
        wavelengthCol: 0,
        psiCol: 1,
        deltaCol: 2,
        aoiCol: -1,
        fixedAoi: 70.0,
        wavelengthUnit: 'nm',
        hasHeader: true,
      },
      distinctAngles: [],
      points: [],
      error: 'No valid data rows found in CSV.',
    };
  }

  const rawRows: string[][] = lines.map((line) => splitCsvLine(line, delimiter));

  // Determine if first row contains non-numeric strings (headers)
  const firstRow = rawRows[0];
  const isHeaderRow = firstRow.some((col) => isNaN(parseFloat(col)) && col.trim() !== '');

  const headers = isHeaderRow
    ? firstRow
    : firstRow.map((_, i) => `Column ${i + 1}`);

  const mapping = deduceColumnMapping(headers);
  mapping.hasHeader = isHeaderRow;

  // Attempt initial conversion
  const parsed = convertRowsToPoints(rawRows, mapping);

  return {
    headers,
    rawRows,
    suggestedMapping: mapping,
    distinctAngles: parsed.distinctAngles,
    points: parsed.points,
  };
}

/**
 * Convert parsed rows to typed EllipsometryDataPoint array using specified mapping
 */
export function convertRowsToPoints(
  rawRows: string[][],
  mapping: CsvColumnMapping
): { points: EllipsometryDataPoint[]; distinctAngles: number[]; error?: string } {
  const startIndex = mapping.hasHeader ? 1 : 0;
  const points: EllipsometryDataPoint[] = [];
  const anglesSet = new Set<number>();

  for (let i = startIndex; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.length === 0 || row.every((c) => c.trim() === '')) continue;

    const rawWl = parseFloat(row[mapping.wavelengthCol]);
    const rawPsi = parseFloat(row[mapping.psiCol]);
    const rawDelta = parseFloat(row[mapping.deltaCol]);

    let aoi = mapping.fixedAoi;
    if (mapping.aoiCol >= 0 && mapping.aoiCol < row.length) {
      const parsedAoi = parseFloat(row[mapping.aoiCol]);
      if (!isNaN(parsedAoi) && parsedAoi > 0 && parsedAoi < 90) {
        aoi = parsedAoi;
      }
    }

    if (![rawWl,rawPsi,rawDelta].every(Number.isFinite)) {
      continue; // Skip invalid numeric rows
    }

    const wavelength = mapping.wavelengthUnit === 'um' ? rawWl * 1000 : rawWl;
    if (wavelength <= 0) continue;

    // Standardize Delta to [0, 360] range
    let stdDelta = rawDelta % 360;
    if (stdDelta < 0) stdDelta += 360;

    // Standardize Psi to [0, 90] range
    const stdPsi = Math.max(0, Math.min(90, rawPsi));

    anglesSet.add(aoi);
    points.push({
      id: `pt_${i}`,
      wavelength,
      aoi,
      psiExp: stdPsi,
      deltaExp: stdDelta,
    });
  }

  if (points.length === 0) {
    return {
      points: [],
      distinctAngles: [],
      error: 'No valid numerical points could be extracted. Please check column mapping.',
    };
  }

  // Sort by AOI then wavelength
  points.sort((a, b) => (a.aoi === b.aoi ? a.wavelength - b.wavelength : a.aoi - b.aoi));

  return {
    points,
    distinctAngles: Array.from(anglesSet).sort((a, b) => a - b),
  };
}
