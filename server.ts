import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  clearSession,
  runOmnisearchAgent,
  type SearchScope,
} from "./server/agent.ts";
import {
  deleteDocument,
  extractTextFromUploadedFile,
  getDocumentContent,
  ingestDocument,
  listDocuments,
} from "./server/rag.ts";
import {
  ALLOWED_VOICES,
  synthesizeSpeech,
  transcribeAudio,
} from "./server/voice.ts";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Terjadi kesalahan pada server.";
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", voices: ALLOWED_VOICES });
});

app.get("/api/documents", (_req, res) => {
  try {
    res.json({ documents: listDocuments() });
  } catch (err) {
    res.status(500).json({ error: extractErrorMessage(err) });
  }
});

app.get("/api/documents/:id", (req, res) => {
  const result = getDocumentContent(req.params.id);
  if (!result) {
    res.status(404).json({ error: "Dokumen tidak ditemukan." });
    return;
  }
  res.json(result);
});

app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "File belum dipilih." });
      return;
    }
    const text = await extractTextFromUploadedFile(
      req.file.originalname,
      req.file.buffer
    );
    const doc = await ingestDocument({
      title: req.file.originalname,
      content: text,
      kind: "file",
      mimeType: req.file.mimetype || "application/octet-stream",
    });
    res.json({ document: doc });
  } catch (err) {
    res.status(400).json({ error: extractErrorMessage(err) });
  }
});

app.post("/api/documents/note", async (req, res) => {
  try {
    const title = String(req.body?.title ?? "").trim();
    const content = String(req.body?.content ?? "").trim();
    if (!title || !content) {
      res.status(400).json({ error: "Judul dan isi catatan wajib diisi." });
      return;
    }
    const doc = await ingestDocument({
      title,
      content,
      kind: "note",
      mimeType: "text/plain",
    });
    res.json({ document: doc });
  } catch (err) {
    res.status(400).json({ error: extractErrorMessage(err) });
  }
});

app.delete("/api/documents/:id", (req, res) => {
  const deleted = deleteDocument(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Dokumen tidak ditemukan." });
    return;
  }
  res.json({ status: "deleted", id: req.params.id });
});

app.post("/api/assistant/text", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? "default").trim();
    const message = String(req.body?.message ?? "").trim();
    const enableTts = Boolean(req.body?.enableTts ?? true);
    const voice = String(req.body?.voice ?? "Kore");
    const scope = (req.body?.scope as SearchScope) || "auto";

    if (!message) {
      res.status(400).json({ error: "Pesan tidak boleh kosong." });
      return;
    }

    const result = await runOmnisearchAgent({
      sessionId,
      userMessage: message,
      scope,
    });

    let audioBase64 = "";
    let ttsError = "";
    if (enableTts && result.answer) {
      try {
        audioBase64 = await synthesizeSpeech(result.answer, voice);
      } catch (err) {
        ttsError = extractErrorMessage(err);
      }
    }

    res.json({
      userText: message,
      assistantText: result.answer,
      toolsUsed: result.toolsUsed,
      sources: result.sources,
      audioBase64,
      audioMimeType: audioBase64 ? "audio/wav" : undefined,
      ttsError: ttsError || undefined,
    });
  } catch (err) {
    res.status(500).json({ error: extractErrorMessage(err) });
  }
});

app.post("/api/assistant/voice", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file || req.file.buffer.length === 0) {
      res.status(400).json({ error: "Rekaman suara kosong." });
      return;
    }

    const sessionId = String(req.body?.sessionId ?? "default").trim();
    const enableTts = String(req.body?.enableTts ?? "true") !== "false";
    const voice = String(req.body?.voice ?? "Kore");
    const scope = (req.body?.scope as SearchScope) || "auto";

    // 1. Speech-to-Text via Gemini 3.5 Transcribe
    const userText = await transcribeAudio(req.file.buffer, req.file.mimetype);

    if (!userText) {
      const fallbackMsg =
        "Maaf, saya tidak menangkap suara dengan jelas. Silakan coba bicara sedikit lebih dekat ke mikrofon.";
      let audioBase64 = "";
      if (enableTts) {
        try {
          audioBase64 = await synthesizeSpeech(fallbackMsg, voice);
        } catch {
          // Ignore TTS error on fallback
        }
      }
      res.json({
        userText: "",
        assistantText: fallbackMsg,
        toolsUsed: [],
        sources: [],
        audioBase64,
        audioMimeType: audioBase64 ? "audio/wav" : undefined,
      });
      return;
    }

    // 2. Omnisearch Agent (Web + Personal RAG + Session Memory)
    const result = await runOmnisearchAgent({
      sessionId,
      userMessage: userText,
      scope,
    });

    // 3. Text-to-Speech via Gemini 3.8 Flash Lite TTS
    let audioBase64 = "";
    let ttsError = "";
    if (enableTts && result.answer) {
      try {
        audioBase64 = await synthesizeSpeech(result.answer, voice);
      } catch (err) {
        ttsError = extractErrorMessage(err);
      }
    }

    res.json({
      userText,
      assistantText: result.answer,
      toolsUsed: result.toolsUsed,
      sources: result.sources,
      audioBase64,
      audioMimeType: audioBase64 ? "audio/wav" : undefined,
      ttsError: ttsError || undefined,
    });
  } catch (err) {
    res.status(500).json({ error: extractErrorMessage(err) });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const text = String(req.body?.text ?? "").trim();
    const voice = String(req.body?.voice ?? "Kore");
    if (!text) {
      res.status(400).json({ error: "Teks kosong." });
      return;
    }
    const audioBase64 = await synthesizeSpeech(text, voice);
    res.json({ audioBase64, audioMimeType: "audio/wav" });
  } catch (err) {
    res.status(500).json({ error: extractErrorMessage(err) });
  }
});

app.delete("/api/session/:sessionId", (req, res) => {
  clearSession(req.params.sessionId);
  res.json({ status: "cleared", sessionId: req.params.sessionId });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`OmniVoice server running on http://localhost:${PORT}`);
  });
}

startServer();
