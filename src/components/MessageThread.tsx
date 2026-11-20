import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  Square,
  Volume2,
} from "lucide-react";
import type { ChatMessage } from "../types";

interface MessageThreadProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  processingStage: string;
  playingMessageId: string | null;
  loadingAudioId: string | null;
  onPlayAudio: (message: ChatMessage) => void;
  onStopAudio: () => void;
  onSelectQuickPrompt: (prompt: string) => void;
  onInspectDocument: (docId: string) => void;
}

const QUICK_PROMPTS: Array<{
  title: string;
  query: string;
  category: string;
}> = [
  {
    category: "Data Pribadi",
    title: "Cek jadwal minggu ini",
    query: "Kapan jadwal dokter gigi dan review desain saya minggu ini?",
  },
  {
    category: "Data Pribadi",
    title: "Ringkas rapat Proyek Q4",
    query: "Apa target peluncuran dan batas anggaran cloud dari catatan rapat Proyek Q4?",
  },
  {
    category: "Internet Real-Time",
    title: "Kurs dolar hari ini",
    query: "Berapa kurs dolar Amerika Serikat ke rupiah hari ini?",
  },
  {
    category: "Internet Real-Time",
    title: "Berita teknologi terbaru",
    query: "Ringkas 3 berita teknologi AI paling penting minggu ini dalam kalimat singkat.",
  },
];

export default function MessageThread({
  messages,
  isProcessing,
  processingStage,
  playingMessageId,
  loadingAudioId,
  onPlayAudio,
  onStopAudio,
  onSelectQuickPrompt,
  onInspectDocument,
}: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  const handleCopy = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedId(msg.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return "";
    }
  };

  const describeSources = (toolsUsed?: Array<"web_search" | "personal_rag">) => {
    if (!toolsUsed || toolsUsed.length === 0) return "Pengetahuan Umum";
    const hasWeb = toolsUsed.includes("web_search");
    const hasPersonal = toolsUsed.includes("personal_rag");
    if (hasWeb && hasPersonal) return "Internet & Dokumen Pribadi";
    if (hasPersonal) return "Dokumen Pribadi";
    return "Internet Real-Time";
  };

  if (messages.length === 0 && !isProcessing) {
    return (
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-12 flex items-center justify-center">
        <div className="w-full max-w-3xl space-y-10">
          <div className="space-y-3 max-w-2xl">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#F0F6FC] [text-wrap:balance]">
              Apa yang ingin Anda cari hari ini?
            </h1>
            <p className="text-[15px] leading-relaxed text-[#94A3B8]">
              Bicara lewat mikrofon atau ketik pertanyaan. OmniVoice otomatis membedakan
              pencarian informasi publik real-time di internet dan pencarian catatan atau
              PDF di Brankas Data pribadi Anda.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => onSelectQuickPrompt(item.query)}
                className="group text-left p-4 rounded-xl bg-[#111620] hover:bg-[#161D2A] border border-[#1E2633] hover:border-[#2E3B50] transition-colors space-y-1.5"
              >
                <div className="text-xs font-medium text-[#60A5FA]">
                  {item.category}
                </div>
                <div className="text-sm font-medium text-[#EDF2F7] group-hover:text-white">
                  {item.title}
                </div>
                <p className="text-xs text-[#8B98AB] leading-relaxed line-clamp-2">
                  {item.query}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isPlaying = playingMessageId === msg.id;
          const isLoadingAudio = loadingAudioId === msg.id;

          if (isUser) {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[82%] space-y-1.5">
                  <div className="px-4 py-3 rounded-2xl rounded-br-sm bg-[#162030] border border-[#243247] text-[15px] leading-relaxed text-[#F0F6FC]">
                    {msg.text}
                  </div>
                  <div className="flex items-center justify-end gap-1.5 text-[11px] text-[#64748B] font-mono tabular-nums pr-1">
                    <span>{msg.inputMode === "voice" ? "Suara" : "Teks"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTime(msg.timestamp)}</span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <article key={msg.id} className="space-y-3">
              {/* Quiet unboxed metadata header */}
              <div className="flex items-center gap-2 text-xs text-[#7F8FA6]">
                <span className="font-medium text-[#CBD5E1]">OmniVoice</span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    msg.error
                      ? "text-[#FCA5A5]"
                      : msg.toolsUsed?.includes("personal_rag")
                        ? "text-[#93C5FD]"
                        : "text-[#8B98AB]"
                  }
                >
                  {msg.error ? "Kendala Permintaan" : describeSources(msg.toolsUsed)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-[11px] text-[#64748B]">
                  {formatTime(msg.timestamp)}
                </span>
              </div>

              {/* Clean prose answer */}
              <div
                className={`text-[15px] leading-[1.7] max-w-[68ch] whitespace-pre-wrap ${
                  msg.error ? "text-[#FCA5A5]" : "text-[#E6EDF5]"
                }`}
              >
                {msg.text}
              </div>

              {/* Functional audio & copy controls */}
              {!msg.error && (
                <div className="flex items-center gap-4 pt-0.5">
                  <button
                    type="button"
                    onClick={() => (isPlaying ? onStopAudio() : onPlayAudio(msg))}
                    disabled={isLoadingAudio}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8B98AB] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
                  >
                    {isLoadingAudio ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#60A5FA]" />
                    ) : isPlaying ? (
                      <Square className="w-3 h-3 fill-[#60A5FA] text-[#60A5FA]" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-[#60A5FA]" />
                    )}
                    <span>
                      {isLoadingAudio
                        ? "Menyiapkan suara..."
                        : isPlaying
                          ? "Hentikan suara"
                          : "Putar suara"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy(msg)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8B98AB] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                        <span className="text-[#4ADE80]">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Salin</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Grounded Citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="pt-2.5 border-t border-[#1A212E] flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {msg.sources.map((src, idx) =>
                    src.kind === "web" && src.url ? (
                      <a
                        key={`${src.url}-${idx}`}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-[#7F8FA6] hover:text-[#93C5FD] transition-colors max-w-[260px]"
                      >
                        <Globe className="w-3 h-3 shrink-0" />
                        <span className="truncate">{src.title}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                      </a>
                    ) : (
                      <button
                        key={`${src.title}-${idx}`}
                        type="button"
                        onClick={() => src.docId && onInspectDocument(src.docId)}
                        className="inline-flex items-center gap-1.5 text-xs text-[#93C5FD] hover:text-white transition-colors max-w-[260px]"
                      >
                        <Database className="w-3 h-3 shrink-0" />
                        <span className="truncate">{src.title}</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </article>
          );
        })}

        {isProcessing && (
          <div className="space-y-2.5 py-2">
            <div className="flex items-center gap-2 text-xs text-[#7DD3FC]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{processingStage || "Mencari & merangkum informasi..."}</span>
            </div>
            <div className="space-y-2 max-w-lg">
              <div className="h-3.5 w-11/12 rounded bg-[#141B26] animate-pulse" />
              <div className="h-3.5 w-8/12 rounded bg-[#141B26] animate-pulse" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
