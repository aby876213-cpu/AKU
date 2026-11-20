import { getGeminiClient } from "./gemini.ts";

export const ALLOWED_VOICES = ["Kore", "Zephyr", "Puck", "Charon", "Fenrir"] as const;
export type VoiceName = (typeof ALLOWED_VOICES)[number];

export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const ai = getGeminiClient();
  const cleanMime = (mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";

  const response = await ai.models.generateContent({
    model: "gemini-3.5-transcribe",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: cleanMime,
            data: audioBuffer.toString("base64"),
          },
        },
        {
          text: "Transkripsikan ucapan dalam audio ini secara akurat sesuai bahasa yang diucapkan (Indonesia atau Inggris). Keluarkan hanya teks transkrip tanpa tanda kutip atau penjelasan tambahan. Jika hening atau tidak ada kata yang terdengar, kembalikan string kosong.",
        },
      ],
    },
  });

  return (response.text ?? "").trim();
}

export async function synthesizeSpeech(
  text: string,
  voiceName: string = "Kore"
): Promise<string> {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return "";

  const safeVoice: VoiceName = ALLOWED_VOICES.includes(voiceName as VoiceName)
    ? (voiceName as VoiceName)
    : "Kore";

  // Keep spoken response snappy and within comfortable audio clip duration
  const spokenText = cleaned.length > 1400 ? `${cleaned.slice(0, 1400)}...` : cleaned;
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash-lite-tts",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: spokenText,
            speechMetadata: {
              style: "Clear, warm, natural personal voice assistant speaking smoothly",
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: safeVoice },
        },
      },
    },
  });

  const base64Audio =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? "";
  return base64Audio;
}
