import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Database,
  Globe,
  Loader2,
  Mic,
  Radio,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import type { SearchScope } from "../types";

interface AcousticDockProps {
  isProcessing: boolean;
  processingStage: string;
  isSpeaking: boolean;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  onSendText: (text: string) => void;
  onAudioCaptured: (blob: Blob) => void;
  onStopSpeaking: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export default function AcousticDock({
  isProcessing,
  processingStage,
  isSpeaking,
  scope,
  onScopeChange,
  onSendText,
  onAudioCaptured,
  onStopSpeaking,
}: AcousticDockProps) {
  const [textInput, setTextInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakeWordHint, setWakeWordHint] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const wakeWordSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const cleanupAudioResources = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupAudioResources();
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const drawWaveform = (analyser: AnalyserNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      rafRef.current = requestAnimationFrame(renderFrame);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 34;
      const barWidth = 3;
      const gap = (width - barCount * barWidth) / (barCount - 1);

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.min(bufferLength - 1, Math.floor(i * 1.4) + 1);
        const raw = dataArray[binIndex] ?? 0;
        const normalized = Math.pow(raw / 255, 0.85);
        const barHeight = Math.max(4, normalized * (height - 6));
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        ctx.fillStyle = normalized > 0.55 ? "#38BDF8" : "#2F81F7";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    renderFrame();
  };

  const startRecording = async () => {
    if (isProcessing || isRecording) return;
    setMicError(null);
    onStopSpeaking();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);

      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        cleanupAudioResources();
        setRecordingSeconds(0);
        if (blob.size > 0) {
          onAudioCaptured(blob);
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      requestAnimationFrame(() => drawWaveform(analyser));
    } catch {
      setMicError(
        "Akses mikrofon tidak diizinkan atau perangkat mikrofon tidak terdeteksi."
      );
      cleanupAudioResources();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Wake word listener ("Halo Omni" / "Hey Omni") using Web Speech API
  useEffect(() => {
    if (!wakeWordEnabled || !wakeWordSupported) {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      return;
    }

    if (isRecording || isProcessing) {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      return;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "id-ID";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = (result[0]?.transcript || "").trim().toLowerCase();
        const match = transcript.match(/(?:halo|hai|hey|hei)\s+omni(?:voice)?[,\s]*(.*)/i);
        if (match) {
          const remainder = (match[1] || "").trim();
          if (result.isFinal && remainder.length >= 3) {
            setWakeWordHint(`Terdeteksi: "${remainder}"`);
            onSendText(remainder);
            window.setTimeout(() => setWakeWordHint(null), 3000);
          } else if (result.isFinal) {
            setWakeWordHint("Wake word terdeteksi, mulai merekam...");
            recognition.onend = null;
            recognition.stop();
            startRecording();
            window.setTimeout(() => setWakeWordHint(null), 2500);
          }
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setMicError("Izin mikrofon dibutuhkan untuk mode Wake Word.");
        setWakeWordEnabled(false);
      }
    };

    recognition.onend = () => {
      if (wakeWordEnabled && !isRecording && !isProcessing) {
        try {
          recognition.start();
        } catch {
          // Ignore already-started race
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // Ignore start race
    }

    return () => {
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Ignore stop race
      }
    };
  }, [wakeWordEnabled, wakeWordSupported, isRecording, isProcessing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed || isProcessing) return;
    onStopSpeaking();
    setTextInput("");
    onSendText(trimmed);
  };

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
      .toString()
      .padStart(2, "0");
    const secs = (totalSec % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  return (
    <div className="border-t border-[#1E2633] bg-[#0D1117]/95 backdrop-blur-md px-4 sm:px-6 py-4">
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Inline error or wake-word status */}
        {micError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-[#2A1418] border border-[#5B232B] text-xs text-[#FCA5A5]"
          >
            <span>{micError}</span>
            <button
              type="button"
              onClick={() => setMicError(null)}
              className="text-[#F87171] hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Controls row: Scope segmented selector + Voice status / Waveform + Wake Word */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Interactive Search Scope Segmented Control */}
          <div
            className="inline-flex items-center p-0.5 rounded-lg bg-[#151B23] border border-[#222B38]"
            role="group"
            aria-label="Sumber pencarian"
          >
            {(
              [
                { id: "auto", label: "Otomatis", icon: AudioLines },
                { id: "web", label: "Internet", icon: Globe },
                { id: "personal", label: "Data Pribadi", icon: Database },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = scope === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onScopeChange(item.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? "bg-[#222B3A] text-[#F0F6FC]"
                      : "text-[#8B98AB] hover:text-[#D1DAE6]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Live Acoustic Waveform or Active Voice Feedback */}
          <div className="flex items-center gap-3 min-h-[32px]">
            {isRecording ? (
              <div className="flex items-center gap-3">
                <canvas
                  ref={canvasRef}
                  width={180}
                  height={28}
                  className="block"
                  aria-label="Gelombang suara aktif"
                />
                <span className="font-mono text-xs tabular-nums text-[#F87171]">
                  {formatTimer(recordingSeconds)}
                </span>
              </div>
            ) : isProcessing ? (
              <span className="inline-flex items-center gap-2 text-xs text-[#7DD3FC]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{processingStage || "Memproses permintaan..."}</span>
              </span>
            ) : isSpeaking ? (
              <button
                type="button"
                onClick={onStopSpeaking}
                className="inline-flex items-center gap-2 text-xs text-[#93C5FD] hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Sedang membacakan jawaban · Hentikan</span>
              </button>
            ) : wakeWordHint ? (
              <span className="text-xs text-[#7DD3FC]">{wakeWordHint}</span>
            ) : wakeWordEnabled ? (
              <span className="text-xs text-[#8B98AB]">
                Ucapkan &ldquo;Halo Omni&rdquo; untuk memulai
              </span>
            ) : null}

            {wakeWordSupported && (
              <button
                type="button"
                onClick={() => setWakeWordEnabled((v) => !v)}
                disabled={isRecording}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                  wakeWordEnabled
                    ? "bg-[#14233C] border-[#2F81F7] text-[#93C5FD]"
                    : "bg-[#151B23] border-[#222B38] text-[#8B98AB] hover:text-[#D1DAE6]"
                }`}
                title='Aktifkan deteksi suara bebas genggam ("Halo Omni")'
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{wakeWordEnabled ? "Halo Omni Aktif" : "Halo Omni"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Input Row: Push-to-Talk Mic + Text Box + Submit */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            aria-label={isRecording ? "Hentikan rekaman suara" : "Mulai rekam suara"}
            className={`relative flex items-center justify-center w-11 h-11 rounded-xl shrink-0 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F81F7] ${
              isRecording
                ? "bg-[#DC2626] hover:bg-[#B91C1C] text-white"
                : isProcessing
                  ? "bg-[#1A2230] text-[#526075] cursor-not-allowed"
                  : "bg-[#2F81F7] hover:bg-[#3B8BF9] text-white"
            }`}
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isRecording ? (
              <Square className="w-4 h-4 fill-white" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          <div className="relative flex-1">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={isProcessing || isRecording}
              placeholder={
                isRecording
                  ? "Mendengarkan suara Anda... klik tombol merah saat selesai"
                  : "Tanyakan berita, cuaca, jadwal, atau cari isi dokumen pribadi..."
              }
              className="w-full h-11 pl-4 pr-12 rounded-xl bg-[#141A23] border border-[#232D3D] text-sm text-[#F0F6FC] placeholder:text-[#66768C] focus:outline-none focus:border-[#2F81F7] transition-colors disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isProcessing || isRecording || !textInput.trim()}
              aria-label="Kirim pesan"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#222C3B] disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
