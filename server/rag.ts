import crypto from "crypto";
import fs from "fs";
import path from "path";
import { extractText } from "unpdf";
import { getGeminiClient } from "./gemini.ts";

export interface StoredChunk {
  id: string;
  docId: string;
  docTitle: string;
  text: string;
  embedding?: number[];
}

export interface StoredDocument {
  id: string;
  title: string;
  kind: "note" | "file";
  mimeType: string;
  charCount: number;
  chunkCount: number;
  preview: string;
  createdAt: string;
}

interface KnowledgeStore {
  documents: StoredDocument[];
  chunks: StoredChunk[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "knowledge_base.json");

const SEED_NOTES: Array<{ title: string; content: string }> = [
  {
    title: "Jadwal Minggu Ini",
    content:
      "Senin 09:30 WIB: Standup Tim Produk di Ruang Merapi. Rabu 14:00 WIB: Review desain aplikasi mobile bersama Dinda dan Reza. Jumat 15:00 WIB: Jadwal dokter gigi di Klinik Senyum Sehat Kemang (drg. Maya). Sabtu 08:00 WIB: Lari pagi 5K di GBK bersama komunitas.",
  },
  {
    title: "Catatan Rapat Proyek Q4",
    content:
      "Keputusan rapat Proyek Q4: Target peluncuran fitur pencarian suara adalah 12 Desember. Anggaran infrastruktur cloud disetujui maksimal Rp 18.500.000 per bulan. Prioritas utama: latensi suara di bawah 1,5 detik, dukungan unggah PDF untuk catatan pribadi, dan ringkasan otomatis rapat mingguan. Penanggung jawab backend: Arya, frontend: Nadia.",
  },
  {
    title: "Daftar Belanja & Anggaran Bulanan",
    content:
      "Anggaran bulanan rumah tangga: Kebutuhan dapur Rp 3.200.000, listrik & internet Rp 950.000, transportasi Rp 1.100.000, tabungan darurat Rp 2.500.000. Daftar belanja akhir pekan: biji kopi Arabika Gayo 500g, susu oat 2 liter, dada ayam 1 kg, alpukat, dan kertas A4 untuk printer.",
  },
];

let storeCache: KnowledgeStore | null = null;

function chunkText(raw: string, chunkSize = 700, overlap = 120): string[] {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + chunkSize, cleaned.length);
    chunks.push(cleaned.slice(start, end).trim());
    if (end >= cleaned.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

function saveStore(store: KnowledgeStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function loadStore(): KnowledgeStore {
  if (storeCache) return storeCache;

  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as KnowledgeStore;
      if (Array.isArray(parsed.documents) && Array.isArray(parsed.chunks)) {
        storeCache = parsed;
        return storeCache;
      }
    } catch {
      // Recreate clean store below if corrupted
    }
  }

  // Initialize with realistic sample notes so user can immediately test personal RAG
  const documents: StoredDocument[] = [];
  const chunks: StoredChunk[] = [];
  const now = new Date().toISOString();

  for (const seed of SEED_NOTES) {
    const docId = crypto.randomUUID();
    const textChunks = chunkText(seed.content);
    documents.push({
      id: docId,
      title: seed.title,
      kind: "note",
      mimeType: "text/plain",
      charCount: seed.content.length,
      chunkCount: textChunks.length,
      preview: seed.content.slice(0, 160),
      createdAt: now,
    });
    for (const text of textChunks) {
      chunks.push({
        id: crypto.randomUUID(),
        docId,
        docTitle: seed.title,
        text,
      });
    }
  }

  storeCache = { documents, chunks };
  saveStore(storeCache);
  return storeCache;
}

async function embedText(text: string): Promise<number[] | null> {
  try {
    const ai = getGeminiClient();
    const res = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: [text],
    });
    const values = res.embeddings?.[0]?.values;
    return Array.isArray(values) && values.length > 0 ? values : null;
  } catch (err) {
    console.warn("Embedding fallback to lexical scoring:", err instanceof Error ? err.message : err);
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function lexicalScore(query: string, docTitle: string, text: string): number {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const haystack = `${docTitle} ${text}`.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits / tokens.length;
}

export function listDocuments(): StoredDocument[] {
  const store = loadStore();
  return [...store.documents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getDocumentContent(docId: string): { document: StoredDocument; content: string } | null {
  const store = loadStore();
  const doc = store.documents.find((d) => d.id === docId);
  if (!doc) return null;
  const content = store.chunks
    .filter((c) => c.docId === docId)
    .map((c) => c.text)
    .join("\n\n");
  return { document: doc, content };
}

export function deleteDocument(docId: string): boolean {
  const store = loadStore();
  const prevLen = store.documents.length;
  store.documents = store.documents.filter((d) => d.id !== docId);
  store.chunks = store.chunks.filter((c) => c.docId !== docId);
  if (store.documents.length !== prevLen) {
    saveStore(store);
    return true;
  }
  return false;
}

export async function extractTextFromUploadedFile(
  filename: string,
  buffer: Buffer
): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    return (text || "").trim();
  }
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json")
  ) {
    return buffer.toString("utf-8").trim();
  }
  throw new Error(
    "Format file belum didukung. Gunakan PDF, TXT, MD, CSV, atau JSON."
  );
}

export async function ingestDocument(params: {
  title: string;
  content: string;
  kind: "note" | "file";
  mimeType: string;
}): Promise<StoredDocument> {
  const cleaned = params.content.trim();
  if (!cleaned) {
    throw new Error("Isi dokumen atau catatan tidak boleh kosong.");
  }

  const store = loadStore();
  const docId = crypto.randomUUID();
  const textChunks = chunkText(cleaned);

  const newChunks: StoredChunk[] = [];
  for (const text of textChunks) {
    const embedding = await embedText(`${params.title}\n${text}`);
    newChunks.push({
      id: crypto.randomUUID(),
      docId,
      docTitle: params.title,
      text,
      embedding: embedding ?? undefined,
    });
  }

  const doc: StoredDocument = {
    id: docId,
    title: params.title,
    kind: params.kind,
    mimeType: params.mimeType,
    charCount: cleaned.length,
    chunkCount: newChunks.length,
    preview: cleaned.slice(0, 160),
    createdAt: new Date().toISOString(),
  };

  store.documents.push(doc);
  store.chunks.push(...newChunks);
  saveStore(store);
  return doc;
}

export interface PersonalSearchHit {
  docId: string;
  title: string;
  snippet: string;
  score: number;
}

export async function searchPersonalDocs(
  query: string,
  topK = 4
): Promise<{
  found: boolean;
  context: string;
  hits: PersonalSearchHit[];
}> {
  const store = loadStore();
  if (store.chunks.length === 0) {
    return {
      found: false,
      context: "Belum ada dokumen atau catatan pribadi yang tersimpan di Brankas Data.",
      hits: [],
    };
  }

  // Lazily embed any unembedded seed chunks
  let storeModified = false;
  const queryEmbedding = await embedText(query);
  if (queryEmbedding) {
    for (const chunk of store.chunks) {
      if (!chunk.embedding) {
        const emb = await embedText(`${chunk.docTitle}\n${chunk.text}`);
        if (emb) {
          chunk.embedding = emb;
          storeModified = true;
        }
      }
    }
    if (storeModified) {
      saveStore(store);
    }
  }

  const scored = store.chunks.map((chunk) => {
    const lex = lexicalScore(query, chunk.docTitle, chunk.text);
    const vec =
      queryEmbedding && chunk.embedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0;
    // Hybrid vector + lexical score for strong Indonesian & English precision
    const combined = queryEmbedding && chunk.embedding ? vec * 0.78 + lex * 0.22 : lex;
    return { chunk, score: combined };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).filter((item) => item.score > 0.12);

  if (top.length === 0) {
    return {
      found: false,
      context:
        "Tidak ditemukan informasi yang relevan dengan pertanyaan ini di dokumen pribadi pengguna.",
      hits: [],
    };
  }

  const hits: PersonalSearchHit[] = [];
  const seenDocIds = new Set<string>();
  const snippets: string[] = [];

  for (const item of top) {
    snippets.push(`[Sumber Dokumen Pribadi: ${item.chunk.docTitle}]\n${item.chunk.text}`);
    if (!seenDocIds.has(item.chunk.docId)) {
      seenDocIds.add(item.chunk.docId);
      hits.push({
        docId: item.chunk.docId,
        title: item.chunk.docTitle,
        snippet: item.chunk.text.slice(0, 140),
        score: Number(item.score.toFixed(3)),
      });
    }
  }

  return {
    found: true,
    context: snippets.join("\n\n---\n\n"),
    hits,
  };
}
