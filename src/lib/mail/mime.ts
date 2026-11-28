import type { EmailAddress, EmailAttachment, EmailHeader, ParsedEmail } from "./types";

interface ContentTypeInfo {
  mimeType: string;
  charset: string;
  boundary: string | null;
  name: string | null;
}

interface ContentDispositionInfo {
  disposition: string | null;
  filename: string | null;
}

interface DecodedPart {
  headers: EmailHeader[];
  headerMap: Map<string, string>;
  body: Buffer;
}

export interface ExtractedAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Decode a byte buffer using the declared charset, falling back to UTF-8.
 */
function decodeCharset(buf: Buffer, charset: string): string {
  const normalized = charset.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(normalized, { fatal: false }).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/**
 * Decode RFC 2047 encoded words such as =?UTF-8?B?...?= or =?ISO-8859-1?Q?...?=.
 */
export function decodeMimeWords(input: string): string {
  if (!input.includes("=?")) return input;
  // Adjacent encoded words separated only by whitespace should have whitespace collapsed per RFC 2047
  const collapsed = input.replace(/\?=\s+=\?/g, "?==?");
  return collapsed.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_full, charset: string, encoding: string, payload: string) => {
      try {
        if (encoding.toUpperCase() === "B") {
          const buf = Buffer.from(payload, "base64");
          return decodeCharset(buf, charset);
        }
        // Quoted-printable in RFC 2047 treats '_' as space
        const qp = payload.replace(/_/g, " ");
        const buf = decodeQuotedPrintable(qp);
        return decodeCharset(buf, charset);
      } catch {
        return _full;
      }
    },
  );
}

/**
 * Decode quoted-printable ASCII text into raw bytes.
 */
export function decodeQuotedPrintable(input: string): Buffer {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "=" && i + 2 < cleaned.length) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(cleaned.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

function splitHeadersAndBody(rawLatin1: string): { headerText: string; bodyText: string } {
  const crlfIdx = rawLatin1.indexOf("\r\n\r\n");
  const lfIdx = rawLatin1.indexOf("\n\n");

  let splitIdx = -1;
  let sepLen = 0;
  if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx < lfIdx)) {
    splitIdx = crlfIdx;
    sepLen = 4;
  } else if (lfIdx !== -1) {
    splitIdx = lfIdx;
    sepLen = 2;
  }

  if (splitIdx === -1) {
    return { headerText: rawLatin1, bodyText: "" };
  }
  return {
    headerText: rawLatin1.slice(0, splitIdx),
    bodyText: rawLatin1.slice(splitIdx + sepLen),
  };
}

function parseHeaders(headerText: string): {
  headers: EmailHeader[];
  headerMap: Map<string, string>;
} {
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
  const lines = unfolded.split(/\r?\n/);
  const headers: EmailHeader[] = [];
  const headerMap = new Map<string, string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const name = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    const decodedValue = decodeMimeWords(rawValue);
    headers.push({ name, value: decodedValue });
    const lower = name.toLowerCase();
    if (!headerMap.has(lower)) {
      headerMap.set(lower, decodedValue);
    }
  }

  return { headers, headerMap };
}

function parseHeaderParams(rawValue: string): { primary: string; params: Record<string, string> } {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < rawValue.length; i++) {
    const ch = rawValue[i];
    if (ch === '"' && rawValue[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ";" && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const primary = (parts[0] ?? "").toLowerCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx === -1) continue;
    const key = parts[i].slice(0, eqIdx).trim().toLowerCase();
    let val = parts[i].slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    params[key] = decodeMimeWords(val);
  }

  return { primary, params };
}

function parseContentType(raw: string | undefined): ContentTypeInfo {
  if (!raw) {
    return { mimeType: "text/plain", charset: "utf-8", boundary: null, name: null };
  }
  const { primary, params } = parseHeaderParams(raw);
  return {
    mimeType: primary || "text/plain",
    charset: params.charset || "utf-8",
    boundary: params.boundary || null,
    name: params.name || null,
  };
}

function parseContentDisposition(raw: string | undefined): ContentDispositionInfo {
  if (!raw) return { disposition: null, filename: null };
  const { primary, params } = parseHeaderParams(raw);
  return {
    disposition: primary || null,
    filename: params.filename || null,
  };
}

function decodeTransferEncoding(bodyLatin1: string, encoding: string | undefined): Buffer {
  const enc = (encoding ?? "7bit").trim().toLowerCase();
  if (enc === "base64") {
    const cleaned = bodyLatin1.replace(/[\r\n\s]/g, "");
    return Buffer.from(cleaned, "base64");
  }
  if (enc === "quoted-printable") {
    return decodeQuotedPrintable(bodyLatin1);
  }
  return Buffer.from(bodyLatin1, "latin1");
}

function splitMultipart(bodyLatin1: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const lines = bodyLatin1.split(/\r?\n/);
  const parts: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === delimiter || line === `${delimiter}--`) {
      if (current !== null) {
        parts.push(current.join("\r\n"));
      }
      if (line === `${delimiter}--`) {
        current = null;
        break;
      }
      current = [];
    } else if (current !== null) {
      current.push(line);
    }
  }

  if (current !== null && current.length > 0) {
    parts.push(current.join("\r\n"));
  }
  return parts;
}

export function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw || !raw.trim()) return [];
  const entries: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && raw[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      if (current.trim()) entries.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) entries.push(current.trim());

  const results: EmailAddress[] = [];
  for (const entry of entries) {
    const angleMatch = entry.match(/^(.*?)<\s*([^<>\s]+)\s*>\s*$/);
    if (angleMatch) {
      let name = angleMatch[1].trim();
      if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
        name = name.slice(1, -1).replace(/\\(.)/g, "$1").trim();
      }
      results.push({
        name: name ? decodeMimeWords(name) : null,
        address: angleMatch[2].trim(),
      });
    } else if (entry.includes("@")) {
      results.push({ name: null, address: entry.replace(/[<>]/g, "").trim() });
    }
  }
  return results;
}

export function normalizeMessageId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<+|>+$/g, "").trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Strip active/dangerous HTML elements and attributes as defense-in-depth
 * alongside iframe sandboxing.
 */
export function sanitizeEmailHtml(html: string): string {
  let safe = html;
  // Remove script, iframe, object, embed, applet, base, form, meta refresh
  safe = safe.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  safe = safe.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  safe = safe.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");
  safe = safe.replace(/<embed\b[^>]*\/?>/gi, "");
  safe = safe.replace(/<base\b[^>]*\/?>/gi, "");
  safe = safe.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
  // Remove inline event handlers (onclick=, onload=, onerror=, etc.)
  safe = safe.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize javascript:/vbscript:/data:text/html URIs in href/src/action
  safe = safe.replace(
    /(\s(?:href|src|action|xlink:href)\s*=\s*["']?)\s*(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/gi,
    "$1blocked:",
  );
  return safe;
}

interface CollectState {
  textParts: string[];
  htmlParts: string[];
  attachments: Array<EmailAttachment & { buffer: Buffer }>;
}

function collectParts(rawLatin1: string, state: CollectState, depth = 0): void {
  if (depth > 10) return;

  const { headerText, bodyText } = splitHeadersAndBody(rawLatin1);
  const { headerMap } = parseHeaders(headerText);
  const ct = parseContentType(headerMap.get("content-type"));
  const cd = parseContentDisposition(headerMap.get("content-disposition"));
  const transferEncoding = headerMap.get("content-transfer-encoding");
  const contentIdRaw = headerMap.get("content-id");
  const contentId = contentIdRaw ? contentIdRaw.trim().replace(/^<|>$/g, "") : null;

  if (ct.mimeType.startsWith("multipart/") && ct.boundary) {
    const subParts = splitMultipart(bodyText, ct.boundary);
    for (const sub of subParts) {
      collectParts(sub, state, depth + 1);
    }
    return;
  }

  const decodedBuf = decodeTransferEncoding(bodyText, transferEncoding);
  const filename = cd.filename || ct.name;
  const isExplicitAttachment = cd.disposition === "attachment";
  const isNamedNonText =
    Boolean(filename) && ct.mimeType !== "text/plain" && ct.mimeType !== "text/html";

  if (isExplicitAttachment || isNamedNonText) {
    const partIndex = state.attachments.length;
    state.attachments.push({
      filename: filename || `attachment-${partIndex + 1}`,
      contentType: ct.mimeType,
      size: decodedBuf.length,
      contentId,
      partIndex,
      buffer: decodedBuf,
    });
    return;
  }

  if (ct.mimeType === "text/plain") {
    state.textParts.push(decodeCharset(decodedBuf, ct.charset));
  } else if (ct.mimeType === "text/html") {
    state.htmlParts.push(decodeCharset(decodedBuf, ct.charset));
  } else if (decodedBuf.length > 0) {
    const partIndex = state.attachments.length;
    state.attachments.push({
      filename: filename || `part-${partIndex + 1}`,
      contentType: ct.mimeType,
      size: decodedBuf.length,
      contentId,
      partIndex,
      buffer: decodedBuf,
    });
  }
}

export function parseRawEmail(rawBuffer: Buffer): ParsedEmail {
  const rawLatin1 = rawBuffer.toString("latin1");
  const { headerText } = splitHeadersAndBody(rawLatin1);
  const { headers, headerMap } = parseHeaders(headerText);

  const state: CollectState = {
    textParts: [],
    htmlParts: [],
    attachments: [],
  };
  collectParts(rawLatin1, state, 0);

  const rawDate = headerMap.get("date");
  let isoDate: string | null = null;
  if (rawDate) {
    const parsedMs = Date.parse(rawDate);
    isoDate = Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : rawDate;
  }

  const html = state.htmlParts.length > 0 ? state.htmlParts.join("\n") : null;
  const text = state.textParts.length > 0 ? state.textParts.join("\n\n") : null;

  return {
    messageId: normalizeMessageId(headerMap.get("message-id")),
    subject: headerMap.get("subject") || "(No Subject)",
    from: parseAddressList(headerMap.get("from")),
    to: parseAddressList(headerMap.get("to")),
    cc: parseAddressList(headerMap.get("cc")),
    replyTo: parseAddressList(headerMap.get("reply-to")),
    date: isoDate,
    html,
    sanitizedHtml: html ? sanitizeEmailHtml(html) : null,
    text,
    headers,
    attachments: state.attachments.map((att) => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      contentId: att.contentId,
      partIndex: att.partIndex,
    })),
    rawSize: rawBuffer.length,
  };
}

export function extractAttachment(
  rawBuffer: Buffer,
  partIndex: number,
): ExtractedAttachment | null {
  const rawLatin1 = rawBuffer.toString("latin1");
  const state: CollectState = {
    textParts: [],
    htmlParts: [],
    attachments: [],
  };
  collectParts(rawLatin1, state, 0);
  const found = state.attachments[partIndex];
  if (!found) return null;
  return {
    filename: found.filename,
    contentType: found.contentType,
    content: found.buffer,
  };
}

/**
 * Fast header-only reader for indexing Message-ID without loading whole attachments.
 */
export function extractHeaderMessageId(headBuffer: Buffer): string | null {
  const latin1 = headBuffer.toString("latin1");
  const { headerText } = splitHeadersAndBody(latin1);
  const { headerMap } = parseHeaders(headerText);
  return normalizeMessageId(headerMap.get("message-id"));
}

export type { DecodedPart };
