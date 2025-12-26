export class ChatRequestDto {
  query: string;
  sessionId?: string; // Optional: pass to continue conversation
}

export class ChatResponseDto {
  answer: string;
  sources: Source[];
  confidence: number;
  sessionId: string;
  metadata: {
    processingTime: number;
    stepsExecuted: string[];
    retrievedDocuments: number;
    queryClassification: string;
    fromCache?: boolean;
    functionCalls?: any[]; // Track function calls executed
  };
}

export class Source {
  entityType: string;
  entityId: string;
  text: string;
  score: number;
  citation: string;
}
