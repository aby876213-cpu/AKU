import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Database,
  Menu,
  MessageSquare,
  Plus,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import AcousticDock from "./components/AcousticDock";
import DocumentModal from "./components/DocumentModal";
import KnowledgeVault from "./components/KnowledgeVault";
import MessageThread from "./components/MessageThread";
import type {
  ChatMessage,
  ChatSession,
  PersonalDocument,
  SearchScope,
  VoiceOption,
} from "./types";

const SESSIONS_STORAGE_KEY = "omnivoice_sessions_v1";
const VOICE_OPTIONS: Array<{ id: VoiceOption; label: string }> = [
  { id: "Kore", label: "Kore" },
  { id: "Zephyr", label: "Zephyr" },
  { id: "Puck", label: "Puck" },
  { id: "Charon", label: "Charon" },
  { id: "Fenrir", label: "Fenrir" },
];

function createEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: `sess-${Math.random().toString(36).slice(2, 10)}`,
    title: "Percakapan Baru",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function loadInitialSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Strip heavy audioBase64 if somehow present in storage
        return parsed.map((s) => ({
          ...s,
          messages: s.messages.map(({ audioBase64: _a, ...rest }) => rest),
        }));
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return [createEmptySession()];
}

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadInitialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => loadInitialSessions()[0].id
  );
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "vault">("sessions");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [documents, setDocuments] = useState<PersonalDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [inspectedDoc, setInspectedDoc] = useState<{
    document: PersonalDocument | null;
    content: string;
    loading: boolean;
  }>({ document: null, content: "", loading: false });

  const [scope, setScope] = useState<SearchScope>("auto");
  const [enableTts, setEnableTts] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>("Kore");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState("");
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  // Persist sessions without large audio payloads
  useEffect(() => {
    try {
      const lightweight = sessions.slice(0, 20).map((session) => ({
        ...session,
        messages: session.messages.map(({ audioBase64: _a, ...rest }) => rest),
      }));
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(lightweight));
    } catch {
      // Ignore quota errors
    }
  }, [sessions]);

  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      if (res.ok && Array.isArray(data.documents)) {
        setDocuments(data.documents);
      }
    } catch {
      // Keep current list on transient network error
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingMessageId(null);
  }, []);

  const playBase64Audio = useCallback(
    (messageId: string, base64: string, mimeType = "audio/wav") => {
      if (!base64) return;
      stopAudio();
      const audio = new Audio(`data:${mimeType};base64,${base64}`);
      audioRef.current = audio;
      setPlayingMessageId(messageId);
      audio.onended = () => {
        setPlayingMessageId(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingMessageId(null);
        audioRef.current = null;
      };
      audio.play().catch(() => {
        setPlayingMessageId(null);
        audioRef.current = null;
      });
    },
    [stopAudio]
  );

  const handlePlayMessageAudio = async (message: ChatMessage) => {
    if (message.audioBase64) {
      playBase64Audio(
        message.id,
        message.audioBase64,
        message.audioMimeType || "audio/wav"
      );
      return;
    }

    setLoadingAudioId(message.id);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.text, voice: selectedVoice }),
      });
      const data = await res.json();
      if (res.ok && data.audioBase64) {
        // Cache in memory for current tab session
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== activeSession.id
              ? s
              : {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === message.id
                      ? {
                          ...m,
                          audioBase64: data.audioBase64,
                          audioMimeType: data.audioMimeType || "audio/wav",
                        }
                      : m
                  ),
                }
          )
        );
        playBase64Audio(
          message.id,
          data.audioBase64,
          data.audioMimeType || "audio/wav"
        );
      }
    } finally {
      setLoadingAudioId(null);
    }
  };

  const appendMessagesToSession = (
    sessionId: string,
    newMessages: ChatMessage[],
    candidateTitle?: string
  ) => {
    const now = new Date().toISOString();
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const shouldUpdateTitle =
          s.messages.length === 0 && candidateTitle && candidateTitle.trim();
        return {
          ...s,
          title: shouldUpdateTitle
            ? candidateTitle.trim().slice(0, 42)
            : s.title,
          updatedAt: now,
          messages: [...s.messages, ...newMessages],
        };
      })
    );
  };

  const handleSendText = async (text: string) => {
    if (!text.trim() || isProcessing) return;
    stopAudio();

    const targetSessionId = activeSession.id;
    const userMsg: ChatMessage = {
      id: `${Date.now()}-u`,
      role: "user",
      text: text.trim(),
      inputMode: "text",
      timestamp: new Date().toISOString(),
    };

    appendMessagesToSession(targetSessionId, [userMsg], text.trim());
    setIsProcessing(true);
    setProcessingStage(
      scope === "personal"
        ? "Mencari di Brankas Data pribadi..."
        : scope === "web"
          ? "Mencari informasi real-time di internet..."
          : "Mencari & merangkum informasi..."
    );

    try {
      const res = await fetch("/api/assistant/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: targetSessionId,
          message: text.trim(),
          enableTts,
          voice: selectedVoice,
          scope,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal memproses permintaan.");
      }

      const assistantMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        role: "assistant",
        text: data.assistantText,
        toolsUsed: data.toolsUsed,
        sources: data.sources,
        audioBase64: data.audioBase64 || undefined,
        audioMimeType: data.audioMimeType || "audio/wav",
        timestamp: new Date().toISOString(),
      };

      appendMessagesToSession(targetSessionId, [assistantMsg]);

      if (enableTts && data.audioBase64) {
        playBase64Audio(
          assistantMsg.id,
          data.audioBase64,
          data.audioMimeType || "audio/wav"
        );
      }
    } catch (err) {
      appendMessagesToSession(targetSessionId, [
        {
          id: `${Date.now()}-err`,
          role: "assistant",
          text:
            err instanceof Error
              ? err.message
              : "Terjadi kesalahan saat menghubungi asisten.",
          timestamp: new Date().toISOString(),
          error: true,
        },
      ]);
    } finally {
      setIsProcessing(false);
      setProcessingStage("");
    }
  };

  const handleAudioCaptured = async (audioBlob: Blob) => {
    if (isProcessing) return;
    stopAudio();

    const targetSessionId = activeSession.id;
    setIsProcessing(true);
    setProcessingStage("Mentranskripsi suara & mencari jawaban...");

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice.webm");
      formData.append("sessionId", targetSessionId);
      formData.append("enableTts", String(enableTts));
      formData.append("voice", selectedVoice);
      formData.append("scope", scope);

      const res = await fetch("/api/assistant/voice", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal memproses rekaman suara.");
      }

      const batch: ChatMessage[] = [];
      if (data.userText) {
        batch.push({
          id: `${Date.now()}-u`,
          role: "user",
          text: data.userText,
          inputMode: "voice",
          timestamp: new Date().toISOString(),
        });
      }

      const assistantMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        role: "assistant",
        text: data.assistantText,
        toolsUsed: data.toolsUsed,
        sources: data.sources,
        audioBase64: data.audioBase64 || undefined,
        audioMimeType: data.audioMimeType || "audio/wav",
        timestamp: new Date().toISOString(),
      };
      batch.push(assistantMsg);

      appendMessagesToSession(targetSessionId, batch, data.userText);

      if (enableTts && data.audioBase64) {
        playBase64Audio(
          assistantMsg.id,
          data.audioBase64,
          data.audioMimeType || "audio/wav"
        );
      }
    } catch (err) {
      appendMessagesToSession(targetSessionId, [
        {
          id: `${Date.now()}-err`,
          role: "assistant",
          text:
            err instanceof Error
              ? err.message
              : "Gagal memproses audio di server.",
          timestamp: new Date().toISOString(),
          error: true,
        },
      ]);
    } finally {
      setIsProcessing(false);
      setProcessingStage("");
    }
  };

  const handleNewSession = () => {
    stopAudio();
    const fresh = createEmptySession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setMobileMenuOpen(false);
  };

  const handleResetActiveSession = async () => {
    stopAudio();
    try {
      await fetch(`/api/session/${encodeURIComponent(activeSession.id)}`, {
        method: "DELETE",
      });
    } catch {
      // Clear local state regardless
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              title: "Percakapan Baru",
              messages: [],
              updatedAt: new Date().toISOString(),
            }
          : s
      )
    );
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (sessionId === activeSession.id) {
      stopAudio();
    }
    try {
      await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
    } catch {
      // Ignore
    }
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        const fresh = createEmptySession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleInspectDocument = async (docId: string) => {
    setInspectedDoc({ document: null, content: "", loading: true });
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}`);
      const data = await res.json();
      if (res.ok && data.document) {
        setInspectedDoc({
          document: data.document,
          content: data.content || "",
          loading: false,
        });
      } else {
        setInspectedDoc({ document: null, content: "", loading: false });
      }
    } catch {
      setInspectedDoc({ document: null, content: "", loading: false });
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const res = await fetch(`/api/documents/${encodeURIComponent(docId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0F141D] border-r border-[#1E2633]">
      {/* Brand Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-[#1E2633] shrink-0">
        <span className="text-base font-bold tracking-tight text-[#F0F6FC] whitespace-nowrap shrink-0">
          OmniVoice
        </span>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Tutup panel samping"
          className="lg:hidden p-1.5 rounded-lg text-[#8B98AB] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sidebar Segmented Switcher */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[#0B0E14] border border-[#1E2633]">
          <button
            type="button"
            onClick={() => setSidebarTab("sessions")}
            className={`inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              sidebarTab === "sessions"
                ? "bg-[#1B2433] text-[#F0F6FC]"
                : "text-[#7F8FA6] hover:text-[#CBD5E1]"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Sesi</span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab("vault")}
            className={`inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              sidebarTab === "vault"
                ? "bg-[#1B2433] text-[#F0F6FC]"
                : "text-[#7F8FA6] hover:text-[#CBD5E1]"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Brankas ({documents.length})</span>
          </button>
        </div>
      </div>

      {/* Sidebar Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {sidebarTab === "sessions" ? (
          <>
            <div className="px-4 py-2 shrink-0">
              <button
                type="button"
                onClick={handleNewSession}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#161E2B] hover:bg-[#1E293B] border border-[#253143] text-xs font-medium text-[#E2E8F0] transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 text-[#60A5FA]" />
                <span>Percakapan Baru</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {sessions.map((session) => {
                const isActive = session.id === activeSession.id;
                return (
                  <div
                    key={session.id}
                    className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                      isActive
                        ? "bg-[#172030] text-[#F0F6FC]"
                        : "text-[#94A3B8] hover:bg-[#141A23] hover:text-[#E2E8F0]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSessionId(session.id);
                        setMobileMenuOpen(false);
                      }}
                      className="flex-1 min-w-0 text-left space-y-0.5"
                    >
                      <div className="text-xs font-medium truncate">
                        {session.title}
                      </div>
                      <div className="text-[11px] text-[#64748B] font-mono tabular-nums">
                        {session.messages.length} pesan
                      </div>
                    </button>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(session.id)}
                        aria-label={`Hapus sesi ${session.title}`}
                        className="p-1 rounded text-[#5B6B82] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#F87171] transition-all shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <KnowledgeVault
            documents={documents}
            isLoading={docsLoading}
            onRefresh={fetchDocuments}
            onSelectDocument={handleInspectDocument}
            onDeleteDocument={handleDeleteDocument}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#0B0E14] text-[#EDF2F7]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[280px] shrink-0 h-full">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden flex bg-black/60 backdrop-blur-xs"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-[290px] max-w-[85vw] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top Bar (SaaS Breadcrumb + Audio Controls) */}
        <header className="h-14 px-4 sm:px-6 border-b border-[#1E2633] bg-[#0D1117] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka navigasi"
              className="lg:hidden p-1.5 -ml-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#172030]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="lg:hidden font-bold text-[#F0F6FC] whitespace-nowrap shrink-0">
                OmniVoice
              </span>
              <span className="lg:hidden text-[#3E4C63]" aria-hidden="true">
                /
              </span>
              <span className="hidden lg:inline text-[#7F8FA6] whitespace-nowrap shrink-0">
                Asisten
              </span>
              <span
                className="hidden lg:inline text-[#3E4C63]"
                aria-hidden="true"
              >
                /
              </span>
              <span className="font-medium text-[#E2E8F0] truncate">
                {activeSession.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Voice persona select */}
            <select
              aria-label="Pilih suara asisten"
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value as VoiceOption)}
              className="hidden sm:block h-8 px-2.5 rounded-lg bg-[#141A23] border border-[#222B38] text-xs font-medium text-[#CBD5E1] focus:outline-none focus:border-[#2F81F7]"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  Suara: {v.label}
                </option>
              ))}
            </select>

            {/* Auto-TTS Toggle */}
            <button
              type="button"
              onClick={() => {
                if (enableTts) stopAudio();
                setEnableTts((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                enableTts
                  ? "bg-[#14233C] border-[#264B80] text-[#93C5FD]"
                  : "bg-[#141A23] border-[#222B38] text-[#7F8FA6] hover:text-[#CBD5E1]"
              }`}
              title={enableTts ? "Matikan baca otomatis" : "Aktifkan baca otomatis"}
            >
              {enableTts ? (
                <Volume2 className="w-3.5 h-3.5" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {enableTts ? "Suara Aktif" : "Senyap"}
              </span>
            </button>

            {/* Reset Session */}
            <button
              type="button"
              onClick={handleResetActiveSession}
              disabled={activeSession.messages.length === 0 || isProcessing}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[#141A23] hover:bg-[#1B2433] border border-[#222B38] text-xs font-medium text-[#94A3B8] hover:text-white disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              title="Bersihkan riwayat percakapan ini"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>
        </header>

        {/* Conversation Stage */}
        <MessageThread
          messages={activeSession.messages}
          isProcessing={isProcessing}
          processingStage={processingStage}
          playingMessageId={playingMessageId}
          loadingAudioId={loadingAudioId}
          onPlayAudio={handlePlayMessageAudio}
          onStopAudio={stopAudio}
          onSelectQuickPrompt={handleSendText}
          onInspectDocument={handleInspectDocument}
        />

        {/* Bottom Voice + Text Input Dock */}
        <AcousticDock
          isProcessing={isProcessing}
          processingStage={processingStage}
          isSpeaking={playingMessageId !== null}
          scope={scope}
          onScopeChange={setScope}
          onSendText={handleSendText}
          onAudioCaptured={handleAudioCaptured}
          onStopSpeaking={stopAudio}
        />
      </div>

      {/* Document Inspector Modal */}
      <DocumentModal
        document={inspectedDoc.document}
        content={inspectedDoc.content}
        isLoading={inspectedDoc.loading}
        onClose={() =>
          setInspectedDoc({ document: null, content: "", loading: false })
        }
        onAskAboutDocument={(title) => {
          setScope("personal");
          handleSendText(`Ringkas poin penting dari dokumen "${title}" saya.`);
        }}
      />
    </div>
  );
}
