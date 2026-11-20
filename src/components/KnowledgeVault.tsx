import React, { useRef, useState } from "react";
import {
  FileText,
  FileUp,
  Loader2,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import type { PersonalDocument } from "../types";

interface KnowledgeVaultProps {
  documents: PersonalDocument[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onSelectDocument: (docId: string) => void;
  onDeleteDocument: (docId: string) => Promise<void>;
}

export default function KnowledgeVault({
  documents,
  isLoading,
  onRefresh,
  onSelectDocument,
  onDeleteDocument,
}: KnowledgeVaultProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredDocs = documents.filter((doc) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.preview.toLowerCase().includes(q)
    );
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal mengunggah dokumen.");
      }
      setStatusMessage({
        type: "success",
        text: `"${data.document.title}" terindeks (${data.document.chunkCount} bagian).`,
      });
      await onRefresh();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Gagal mengunggah dokumen.",
      });
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/documents/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: noteTitle.trim(),
          content: noteContent.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal menyimpan catatan.");
      }
      setNoteTitle("");
      setNoteContent("");
      setShowNoteForm(false);
      setStatusMessage({
        type: "success",
        text: `Catatan "${data.document.title}" tersimpan.`,
      });
      await onRefresh();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Gagal menyimpan catatan.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatShortDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
      }).format(new Date(iso));
    } catch {
      return "";
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Action Row: Upload File + Add Note */}
      <div className="px-4 pt-3 pb-3 space-y-2.5 border-b border-[#1E2633]">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A2332] hover:bg-[#232F42] border border-[#2A3649] text-xs font-medium text-[#E2E8F0] transition-colors whitespace-nowrap"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileUp className="w-3.5 h-3.5 text-[#60A5FA]" />
            )}
            <span>Unggah File</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.csv,.json"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => {
              setShowNoteForm((v) => !v);
              setStatusMessage(null);
            }}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
              showNoteForm
                ? "bg-[#14233C] border-[#2F81F7] text-[#93C5FD]"
                : "bg-[#141A23] hover:bg-[#1C2432] border-[#222B38] text-[#CBD5E1]"
            }`}
          >
            {showNoteForm ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>{showNoteForm ? "Batal" : "Catatan Baru"}</span>
          </button>
        </div>

        <p className="text-[11px] text-[#78869B]">
          Mendukung PDF, TXT, Markdown, CSV, dan JSON.
        </p>

        {/* Inline Add Note Form */}
        {showNoteForm && (
          <form onSubmit={handleSaveNote} className="space-y-2 pt-1">
            <input
              type="text"
              placeholder="Judul catatan (misal: Jadwal Penerbangan)"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0E14] border border-[#242F40] text-xs text-[#F0F6FC] placeholder:text-[#5B6B82] focus:outline-none focus:border-[#2F81F7]"
            />
            <textarea
              rows={3}
              placeholder="Tulis informasi, jadwal, atau ringkasan pribadi..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0E14] border border-[#242F40] text-xs text-[#F0F6FC] placeholder:text-[#5B6B82] focus:outline-none focus:border-[#2F81F7] resize-none"
            />
            <button
              type="submit"
              disabled={isSubmitting || !noteTitle.trim() || !noteContent.trim()}
              className="w-full py-2 rounded-lg bg-[#2F81F7] hover:bg-[#3B8BF9] disabled:opacity-40 text-xs font-medium text-white transition-colors"
            >
              {isSubmitting ? "Menyimpan..." : "Simpan ke Brankas"}
            </button>
          </form>
        )}

        {/* Upload/Save feedback */}
        {statusMessage && (
          <p
            className={`text-xs leading-snug ${
              statusMessage.type === "success"
                ? "text-[#4ADE80]"
                : "text-[#FCA5A5]"
            }`}
          >
            {statusMessage.text}
          </p>
        )}

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#66768C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter dokumen pribadi..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#0B0E14] border border-[#1E2633] text-xs text-[#E2E8F0] placeholder:text-[#5B6B82] focus:outline-none focus:border-[#2F81F7]"
          />
        </div>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <div className="space-y-2 px-2 py-2">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-14 rounded-lg bg-[#141A23] animate-pulse"
              />
            ))}
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="px-3 py-8 text-center space-y-1.5">
            <p className="text-xs font-medium text-[#CBD5E1]">
              {documents.length === 0
                ? "Brankas data masih kosong"
                : "Tidak ada dokumen yang cocok"}
            </p>
            <p className="text-[11px] text-[#78869B]">
              {documents.length === 0
                ? "Unggah PDF atau tambah catatan agar asisten bisa mencari data pribadi Anda."
                : "Coba ubah kata kunci filter di atas."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#1A212E]">
            {filteredDocs.map((doc) => {
              const isConfirming = confirmDeleteId === doc.id;
              return (
                <li
                  key={doc.id}
                  className="group py-2.5 px-2.5 rounded-lg hover:bg-[#141A23] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectDocument(doc.id)}
                      className="flex-1 min-w-0 text-left space-y-1"
                    >
                      <div className="flex items-center gap-1.5">
                        {doc.kind === "file" ? (
                          <FileText className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                        ) : (
                          <StickyNote className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
                        )}
                        <span className="text-xs font-medium text-[#E2E8F0] truncate">
                          {doc.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#78869B] line-clamp-2 leading-relaxed">
                        {doc.preview}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#64748B] font-mono tabular-nums">
                        <span>{doc.kind === "file" ? "File" : "Catatan"}</span>
                        <span aria-hidden="true">·</span>
                        <span>{doc.chunkCount} bagian</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatShortDate(doc.createdAt)}</span>
                      </div>
                    </button>

                    {isConfirming ? (
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await onDeleteDocument(doc.id);
                            setConfirmDeleteId(null);
                          }}
                          className="text-[11px] font-medium text-[#F87171] hover:text-[#FCA5A5]"
                        >
                          Hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] text-[#8B98AB] hover:text-white"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(doc.id)}
                        aria-label={`Hapus ${doc.title}`}
                        className="p-1 rounded text-[#5B6B82] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#F87171] transition-all shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
