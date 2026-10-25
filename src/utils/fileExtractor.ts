/**
 * Extracts readable text content from user-attached files (plain text, CSV, JSON,
 * Markdown, source code, and Office OpenXML .xlsx / .docx / .pptx ZIP containers using
 * native browser DecompressionStream).
 */

const MAX_EXTRACTED_CHARS = 12_000;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'html',
  'htm',
  'yaml',
  'yml',
  'sql',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'sh',
  'env',
  'ini',
  'conf',
  'log',
]);

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

async function decompressDeflateRaw(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    writer.write(copy).catch(() => {});
    writer.close().catch(() => {});

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.byteLength;
      }
    }

    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function xmlToReadableText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/(?:t|si|row|p|tr|v)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSharedStringsXml(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const inner = siMatch[1];
    const tParts: string[] = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      tParts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(tParts.join(''));
  }
  return strings;
}

function parseWorksheetXml(xml: string, sharedStrings: string[]): string {
  const rows: string[] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowInner = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      const attrs = cellMatch[1];
      const cellInner = cellMatch[2];
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const cellType = typeMatch ? typeMatch[1] : '';

      if (cellType === 'inlineStr') {
        const tMatch = /<t\b[^>]*>([\s\S]*?)<\/t>/i.exec(cellInner);
        if (tMatch) {
          const val = decodeXmlEntities(tMatch[1]).trim();
          if (val) cells.push(val);
        }
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellInner);
        if (vMatch) {
          const rawVal = decodeXmlEntities(vMatch[1]).trim();
          if (cellType === 's') {
            const idx = parseInt(rawVal, 10);
            const resolved = !Number.isNaN(idx) && sharedStrings[idx] !== undefined
              ? sharedStrings[idx].trim()
              : rawVal;
            if (resolved) cells.push(resolved);
          } else if (rawVal) {
            cells.push(rawVal);
          }
        }
      }
    }

    if (cells.length > 0) {
      rows.push(cells.join(' | '));
    }
  }

  if (rows.length > 0) {
    return rows.join('\n');
  }
  return xmlToReadableText(xml);
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedData: Uint8Array;
}

function listZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: ZipEntry[] = [];
  const seenNames = new Set<string>();

  // 1. Scan Central Directory Headers (0x02014b50) which reliably carry compressedSize even when bit 3 is set
  let offset = 0;
  while (offset + 46 <= bytes.byteLength) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset++;
      continue;
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd > bytes.byteLength) break;

    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    if (localHeaderOffset + 30 <= bytes.byteLength && view.getUint32(localHeaderOffset, true) === 0x04034b50) {
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (compressedSize > 0 && dataEnd <= bytes.byteLength && !seenNames.has(name)) {
        seenNames.add(name);
        entries.push({
          name,
          compressionMethod,
          compressedData: bytes.subarray(dataStart, dataEnd),
        });
      }
    }

    const nextOffset = nameEnd + extraLen + commentLen;
    offset = nextOffset > offset ? nextOffset : offset + 46;
  }

  if (entries.length > 0) {
    return entries;
  }

  // 2. Fallback: Scan Local File Headers (0x04034b50)
  offset = 0;
  while (offset + 30 <= bytes.byteLength) {
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd > bytes.byteLength) break;

    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (compressedSize > 0 && dataEnd <= bytes.byteLength && !seenNames.has(name)) {
      seenNames.add(name);
      entries.push({
        name,
        compressionMethod,
        compressedData: bytes.subarray(dataStart, dataEnd),
      });
    }

    offset = dataEnd > offset + 30 ? dataEnd : offset + 30;
  }

  return entries;
}

async function decodeZipEntryText(entry: ZipEntry, decoder: TextDecoder): Promise<string | null> {
  let uncompressed: Uint8Array | null = null;
  if (entry.compressionMethod === 0) {
    uncompressed = entry.compressedData;
  } else if (entry.compressionMethod === 8) {
    uncompressed = await decompressDeflateRaw(entry.compressedData);
  }
  if (!uncompressed) return null;
  return decoder.decode(uncompressed);
}

export async function extractOpenXmlText(buffer: ArrayBuffer): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries = listZipEntries(buffer);
  const extractedParts: string[] = [];

  // First load sharedStrings if present (for .xlsx)
  let sharedStrings: string[] = [];
  const sharedStringsEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (sharedStringsEntry) {
    const xml = await decodeZipEntryText(sharedStringsEntry, decoder);
    if (xml) {
      sharedStrings = parseSharedStringsXml(xml);
    }
  }

  // Process worksheets, Word document, or PowerPoint slides
  const contentEntries = entries.filter(
    (e) =>
      e.name.startsWith('xl/worksheets/sheet') ||
      e.name === 'word/document.xml' ||
      e.name.startsWith('ppt/slides/slide')
  );

  for (const entry of contentEntries) {
    const xml = await decodeZipEntryText(entry, decoder);
    if (!xml) continue;

    if (entry.name.startsWith('xl/worksheets/sheet')) {
      const sheetText = parseWorksheetXml(xml, sharedStrings);
      if (sheetText) extractedParts.push(sheetText);
    } else {
      const docText = xmlToReadableText(xml);
      if (docText) extractedParts.push(docText);
    }
  }

  // If worksheet cells had no inline values or failed, fallback to sharedStrings list
  if (extractedParts.length === 0 && sharedStrings.length > 0) {
    extractedParts.push(sharedStrings.join(' | '));
  }

  return extractedParts.join('\n\n').slice(0, MAX_EXTRACTED_CHARS).trim();
}

export interface AttachedFileItem {
  name: string;
  extractedText?: string;
}

export async function extractAttachmentText(file: File): Promise<AttachedFileItem> {
  const ext = getExtension(file.name);

  try {
    if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/') || file.type === 'application/json') {
      const rawText = await file.text();
      const trimmed = rawText.trim().slice(0, MAX_EXTRACTED_CHARS);
      return {
        name: file.name,
        extractedText: trimmed || undefined,
      };
    }

    if (ext === 'xlsx' || ext === 'docx' || ext === 'pptx') {
      const buf = await file.arrayBuffer();
      const openXmlText = await extractOpenXmlText(buf);
      return {
        name: file.name,
        extractedText: openXmlText || undefined,
      };
    }
  } catch {
    // Ignore extraction errors and fall back to filename only
  }

  return { name: file.name };
}
