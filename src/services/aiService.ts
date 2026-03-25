import { GoogleGenAI } from "@google/genai";
import { Document, Project } from "../types";
import { AI_CONFIG } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateGroundedAnswer(
  prompt: string, 
  project: Project, 
  docs: Document[],
  history: { role: string, content: string }[]
) {
  console.log(`Generating grounded answer for prompt: "${prompt}" with ${docs.length} documents.`);
  
  const context = docs.map(d => `SOURCE DOCUMENT: ${d.title}\nCONTENT:\n${d.content}`).join("\n\n---\n\n");
  console.log("Context length for grounding:", context.length);
  if (context.length > 0) {
    console.log("Context snippet:", context.substring(0, 500) + "...");
  }
  
  const systemInstruction = `
    You are VoiceIt, an advanced AI knowledge assistant for the project: ${project.title}.
    
    ABOUT THIS PROJECT:
    ${project.description}
    
    KNOWLEDGE BASE (CONTEXT DOCUMENTS):
    ${docs.length > 0 ? context : "No documents available in the knowledge base."}
    
    INSTRUCTIONS:
    - Answer questions strictly based on the provided KNOWLEDGE BASE.
    - ${project.instructions}
    - If the answer is not in the context, politely say you don't have that information in the current knowledge base.
    - Always cite the document title and a plausible page number if you find the information.
    - Format your response as JSON with 'answer', 'sources' array, and 'showSummary' boolean.
    - Be professional, extremely concise, and accurate.
    - IMPORTANT: Keep your 'answer' very brief (ideally half the length of a standard response) to ensure it fits on a small display screen.
    - SESSION END INSTRUCTION:
      When all questions are asked and answers are given and sources are shown and closed, ask the user: "Is there anything else I can help you with today?".
      If the user indicates they are finished (e.g., "no", "I'm done", "goodbye"), set 'showSummary' to true in your JSON response.
  `;

  console.log("System instruction length:", systemInstruction.length);

  const response = await ai.models.generateContent({
    model: AI_CONFIG.model,
    contents: [
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: "user", parts: [{ text: prompt }] }
    ],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: AI_CONFIG.responseSchema
    }
  });

  console.log("AI Response received.");

  try {
    const parsed = JSON.parse(response.text || "{}");
    console.log("Parsed AI Response:", parsed);
    return parsed;
  } catch (e) {
    console.error("Failed to parse AI response as JSON:", response.text);
    return { answer: response.text, sources: [] };
  }
}
