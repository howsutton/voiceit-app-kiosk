export const API_BASE = '';

export const AI_CONFIG = {
  model: "gemini-1.5-flash-latest",
  responseSchema: {
    type: "OBJECT",
    properties: {
      answer: { type: "STRING" },
      sources: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            documentTitle: { type: "STRING" },
            pageNumber: { type: "NUMBER" },
            excerpt: { type: "STRING" }
          }
        }
      },
      showSummary: { type: "BOOLEAN" }
    }
  }
};
