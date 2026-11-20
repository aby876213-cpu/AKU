import React from "react";
import { FileText, MessageSquare, StickyNote, X } from "lucide-react";
import type { PersonalDocument } from "../types";

interface DocumentModalProps {
  document: PersonalDocument | null;
  content: string;
  isLoading: boolean;
  onClose: () => void;
  onAskAboutDocument: (title: string) => void;
}

export default function DocumentModal({
  document,
  content,
  isLoading,
  onClose,
  onAskAboutDocument,
}: DocumentModalProps) {
  if (!document && !isLoading) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={document?.title || "Pratinjau Dokumen"}
    >
      <div
        className="w-full max-w-2xl max-h-[82vh] flex flex-col rounded-xl bg-[#111620] border border-[#242F40] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[#1E2633]">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              {document?.kind === "file" ? (
                <FileText className="w-4 h-4 text-[#60A5FA] shrink-0" />
              ) : (
                <StickyNote className="w-4 h-4 text-[#94A3B8] shrink-0" />
              )}
              <h2 className="text-sm font-semibold text-[#F0F6FC] truncate">
                {document?.title || "Memuat dokumen..."}
              </h2>
            </div>
            {document && (
              <p className="text-xs text-[#78869B] font-mono tabular-nums">
                {document.kind === "file" ? "File" : "Catatan"} ·{" "}
                {document.chunkCount} bagian · {document.charCount.toLocaleString("id-ID")} karakter
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau"
            className="p-1.5 rounded-lg text-[#8B98AB] hover:text-white hover:bg-[#1C2432] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-2.5">
              <div className="h-4 w-full rounded bg-[#1A2230] animate-pulse" />
              <div className="h-4 w-10/12 rounded bg-[#1A2230] animate-pulse" />
              <div className="h-4 w-8/12 rounded bg-[#1A2230] animate-pulse" />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#CBD5E1]">
              {content}
            </pre>
          )}
        </div>

        {document && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[#1E2633] bg-[#0D1117]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={() => {
                onAskAboutDocument(document.title);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2F81F7] hover:bg-[#3B8BF9] text-xs font-medium text-white transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Ringkas Dokumen Ini</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
