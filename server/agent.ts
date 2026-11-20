import {
  type Content,
  type FunctionDeclaration,
  type Part,
  ThinkingLevel,
  Type,
} from "@google/genai";
import { getGeminiClient } from "./gemini.ts";
import { listDocuments, searchPersonalDocs } from "./rag.ts";

export type SearchScope = "auto" | "web" | "personal";

export interface SourceCitation {
  title: string;
  url: string | null;
  kind: "web" | "personal";
  docId?: string;
}

export interface AgentResult {
  answer: string;
  toolsUsed: Array<"web_search" | "personal_rag">;
  sources: SourceCitation[];
}

const SESSION_STORE = new Map<string, Content[]>();

const searchPersonalDataDeclaration: FunctionDeclaration = {
  name: "search_personal_data",
  description:
    "Mencari informasi di brankas dokumen pribadi pengguna (catatan, jadwal, daftar belanja, anggaran, ringkasan rapat, dan file PDF/TXT yang diunggah). Panggil fungsi ini setiap kali pertanyaan menyinggung data pribadi, jadwal, catatan, atau file milik pengguna.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Kata kunci atau pertanyaan spesifik untuk dicari di dokumen pribadi pengguna.",
      },
    },
    required: ["query"],
  },
};

function buildSystemInstruction(scope: SearchScope): string {
  const nowStr = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());

  const docs = listDocuments();
  const docTitles =
    docs.length > 0
      ? docs.map((d) => `- ${d.title} (${d.kind === "file" ? "File" : "Catatan"})`).join("\n")
      : "- Belum ada dokumen tersimpan.";

  const scopeDirective =
    scope === "web"
      ? "Mode Fokus Aktif: Pengguna memilih pencarian Internet. Gunakan alat web_search (Google Search) untuk menjawab dengan informasi publik terkini."
      : scope === "personal"
        ? "Mode Fokus Aktif: Pengguna memilih pencarian Data Pribadi. Selalu panggil alat `search_personal_data` dan prioritaskan informasi dari brankas pribadi pengguna."
        : "Mode Fokus Aktif: Otomatis. Gunakan `search_personal_data` untuk data pribadi dan `web_search` (Google Search) untuk informasi publik real-time, atau keduanya bila diperlukan.";

  return `Kamu adalah AKU, asisten pribadi cerdas berbasis suara dan teks. Tugas utamamu adalah membantu pengguna menemukan, menyaring, dan menyajikan informasi apa pun secara cepat, akurat, dan mudah dipahami.

Aturan Perilaku & Gaya Bahasa:
1. **Ringkas & Langsung ke Inti (Voice-First):** Karena jawabanmu sering dibacakan secara lisan, hindari basa-basi panjang. Berikan jawaban langsung pada kalimat pertama. Maksimal 2-3 kalimat untuk pertanyaan sederhana, kecuali pengguna meminta penjelasan mendalam.
2. **Proaktif & Kontekstual:** Jika pengguna menanyakan data yang ambigu, berikan jawaban yang paling relevan terlebih dahulu, lalu tawarkan opsi lanjutan secara singkat.
3. **Prioritas Pencarian Data:**
   - Gunakan alat \`search_personal_data\` jika pengguna menanyakan jadwal, catatan, file, atau informasi personal mereka.
   - Gunakan alat \`web_search\` (tersedia melalui Google Search) untuk informasi terkini, fakta umum, berita, atau data real-time.
   - Selalu sebutkan sumber atau konteks waktu secara singkat jika datanya bersifat dinamis (misal: "Menurut catatanmu kemarin..." atau "Berdasarkan data pasar hari ini...").
4. **Format Ramah Suara:** Hindari penggunaan simbol markdown yang rumit (seperti tabel besar atau tanda bintang berlebihan) saat menjawab perintah suara, karena akan sulit dibaca oleh sistem Text-to-Speech. Gunakan bahasa Indonesia yang natural, ramah, namun tetap profesional.
5. **Kejujuran Data:** Jika informasi tidak ditemukan baik di data pribadi maupun internet, katakan terus terang dengan singkat dan tawarkan alternatif pencarian lain.

Konteks Sesi Saat Ini:
- Waktu saat ini: ${nowStr}
- ${scopeDirective}
- Daftar judul dokumen/catatan di Brankas Pribadi pengguna:
${docTitles}`;
}

function trimHistory(history: Content[], maxItems = 24): Content[] {
  if (history.length <= maxItems) return history;
  let sliced = history.slice(history.length - maxItems);
  // Ensure history always begins with a user turn
  const firstUserIdx = sliced.findIndex((item) => item.role === "user");
  if (firstUserIdx > 0) {
    sliced = sliced.slice(firstUserIdx);
  }
  return sliced;
}

export async function runOmnisearchAgent(params: {
  sessionId: string;
  userMessage: string;
  scope?: SearchScope;
}): Promise<AgentResult> {
  const ai = getGeminiClient();
  const scope: SearchScope = params.scope ?? "auto";
  const toolsUsed = new Set<"web_search" | "personal_rag">();
  const collectedSources: SourceCitation[] = [];

  const existingHistory = SESSION_STORE.get(params.sessionId) ?? [];
  const workingContents: Content[] = [
    ...existingHistory,
    { role: "user", parts: [{ text: params.userMessage }] },
  ];

  const tools: Array<Record<string, unknown>> = [];
  if (scope === "auto" || scope === "web") {
    tools.push({ googleSearch: {} });
  }
  if (scope === "auto" || scope === "personal") {
    tools.push({ functionDeclarations: [searchPersonalDataDeclaration] });
  }

  const useHybridConfig = scope === "auto";
  const systemInstruction = buildSystemInstruction(scope);

  let finalAnswer = "";

  for (let step = 0; step < 3; step++) {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: workingContents,
      config: {
        systemInstruction,
        tools,
        ...(useHybridConfig
          ? { toolConfig: { includeServerSideToolInvocations: true } }
          : {}),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const candidate = response.candidates?.[0];
    const modelContent = candidate?.content;

    // Extract Google Search grounding metadata
    const grounding = candidate?.groundingMetadata;
    if (
      (grounding?.webSearchQueries && grounding.webSearchQueries.length > 0) ||
      (grounding?.groundingChunks && grounding.groundingChunks.length > 0)
    ) {
      toolsUsed.add("web_search");
      for (const chunk of grounding.groundingChunks ?? []) {
        if (chunk.web?.uri) {
          collectedSources.push({
            title: chunk.web.title || chunk.web.uri,
            url: chunk.web.uri,
            kind: "web",
          });
        }
      }
    }

    const functionCalls =
      response.functionCalls ??
      modelContent?.parts
        ?.map((p) => p.functionCall)
        .filter((fc): fc is NonNullable<typeof fc> => Boolean(fc)) ??
      [];

    if (modelContent && functionCalls.length > 0) {
      workingContents.push(modelContent);

      const responseParts: Part[] = [];
      for (const call of functionCalls) {
        if (call.name === "search_personal_data") {
          toolsUsed.add("personal_rag");
          const queryArg =
            typeof call.args?.query === "string"
              ? call.args.query
              : params.userMessage;
          const ragResult = await searchPersonalDocs(queryArg);
          for (const hit of ragResult.hits) {
            collectedSources.push({
              title: hit.title,
              url: null,
              kind: "personal",
              docId: hit.docId,
            });
          }
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: {
                found: ragResult.found,
                context: ragResult.context,
              },
            },
          });
        }
      }

      workingContents.push({
        role: "user",
        parts: responseParts,
      });
      continue;
    }

    if (modelContent) {
      workingContents.push(modelContent);
    }
    finalAnswer = (response.text ?? "").trim();
    break;
  }

  if (!finalAnswer) {
    finalAnswer = "Maaf, saya belum menemukan jawaban yang jelas untuk permintaan tersebut.";
  }

  SESSION_STORE.set(params.sessionId, trimHistory(workingContents));

  // Deduplicate citations
  const uniqueSources: SourceCitation[] = [];
  const seen = new Set<string>();
  for (const src of collectedSources) {
    const key = `${src.kind}:${src.title}:${src.url ?? src.docId ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSources.push(src);
    }
  }

  return {
    answer: finalAnswer,
    toolsUsed: Array.from(toolsUsed),
    sources: uniqueSources.slice(0, 6),
  };
}

export function clearSession(sessionId: string): void {
  SESSION_STORE.delete(sessionId);
}
