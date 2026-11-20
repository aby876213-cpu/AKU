export type SearchScope = "auto" | "web" | "personal";

export type VoiceOption = "Kore" | "Zephyr" | "Puck" | "Charon" | "Fenrir";

export interface SourceCitation {
  title: string;
  url: string | null;
  kind: "web" | "personal";
  docId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  inputMode?: "voice" | "text";
  toolsUsed?: Array<"web_search" | "personal_rag">;
  sources?: SourceCitation[];
  audioBase64?: string;
  audioMimeType?: string;
  timestamp: string;
  error?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface PersonalDocument {
  id: string;
  title: string;
  kind: "note" | "file";
  mimeType: string;
  charCount: number;
  chunkCount: number;
  preview: string;
  createdAt: string;
}
