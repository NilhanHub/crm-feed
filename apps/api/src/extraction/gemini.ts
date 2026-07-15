import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import {
  safeParseGeminiExtraction,
  classifyMissingCredentials,
  classifyMalformedJson,
  classifyModelRequestFailed,
  classifyModelTimeout,
  classifySchemaValidationFailed,
  classifyEmptyPeople,
  type ExtractionError,
  type ExtractionPayload,
  GEMINI_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
} from "./types.js";

// Gemini extraction service.
// Loads API key from environment only. Supports configurable model via env.
// Uses dependency injection so tests can use a fake provider.

export interface GeminiServiceConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ExtractionRequest {
  screenshotPath: string;
  screenshotId: string;
  mimeType: string;
  targetCompanyName: string;
  extractionRunId: string;
  batchId: string;
  companyId: string;
}

export interface ExtractionServiceResult {
  success: boolean;
  error?: ExtractionError;
  rawResponseText?: string;
  payload?: ExtractionPayload;
  modelUsed?: string;
  promptVersion?: string;
  extractionSchemaVersion?: string;
}

// Interface for extraction providers — allows dependency injection for tests.
export interface IExtractionProvider {
  extract(request: ExtractionRequest, config: GeminiServiceConfig): Promise<ExtractionServiceResult>;
  isAvailable(): boolean;
}

export class GeminiExtractionProvider implements IExtractionProvider {
  private ai: GoogleGenAI | null = null;
  private readonly config: GeminiServiceConfig;

  constructor(config?: Partial<GeminiServiceConfig>) {
    this.config = {
      apiKey: config?.apiKey ?? process.env.GEMINI_API_KEY,
      model: config?.model ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
      timeoutMs: config?.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS ?? 30000),
      maxRetries: config?.maxRetries ?? Number(process.env.GEMINI_MAX_RETRIES ?? 2),
    };
  }

  isAvailable(): boolean {
    return Boolean(this.config.apiKey);
  }

  private getClient(): GoogleGenAI {
    if (!this.config.apiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }
    if (!this.ai) {
      this.ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    }
    return this.ai;
  }

  async extract(request: ExtractionRequest, _overrideConfig?: GeminiServiceConfig): Promise<ExtractionServiceResult> {
    const modelUsed = this.config.model ?? "gemini-2.0-flash";

    if (!this.isAvailable()) {
      return {
        success: false,
        error: classifyMissingCredentials(),
        modelUsed,
        promptVersion: GEMINI_PROMPT_VERSION,
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      };
    }

    // Read screenshot file
    if (!fs.existsSync(request.screenshotPath)) {
      return {
        success: false,
        error: classifyModelRequestFailed(`Screenshot file not found: ${request.screenshotPath}`),
        modelUsed,
        promptVersion: GEMINI_PROMPT_VERSION,
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      };
    }

    const imageBytes = fs.readFileSync(request.screenshotPath);
    const base64Data = imageBytes.toString("base64");

    const prompt = buildPromptText(request.targetCompanyName);

    try {
      const client = this.getClient();

      const response = await client.models.generateContent({
        model: modelUsed,
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: request.mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: buildResponseSchema(),
          httpOptions: {
            timeout: this.config.timeoutMs,
          },
        },
      });

      const rawText = response.text ?? "";

      // Try to parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (e) {
        return {
          success: false,
          error: classifyMalformedJson((e as Error).message),
          rawResponseText: rawText,
          modelUsed,
          promptVersion: GEMINI_PROMPT_VERSION,
          extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        };
      }

      // Validate against Gemini schema
      const validationResult = safeParseGeminiExtraction(parsed);
      if (!validationResult.ok) {
        return {
          success: false,
          error: classifySchemaValidationFailed(validationResult.error),
          rawResponseText: rawText,
          modelUsed,
          promptVersion: GEMINI_PROMPT_VERSION,
          extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        };
      }

      const payload = validationResult.data;

      // Check for empty people
      if (payload.people.length === 0) {
        return {
          success: false,
          error: classifyEmptyPeople(),
          rawResponseText: rawText,
          payload,
          modelUsed,
          promptVersion: GEMINI_PROMPT_VERSION,
          extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        };
      }

      return {
        success: true,
        rawResponseText: rawText,
        payload,
        modelUsed,
        promptVersion: GEMINI_PROMPT_VERSION,
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      };
    } catch (e) {
      const err = e as Error;
      const isTimeout = err.message.includes("timeout") || err.message.includes("TIMEOUT") || err.message.includes("deadline");
      return {
        success: false,
        error: isTimeout
          ? classifyModelTimeout(err.message)
          : classifyModelRequestFailed(err.message),
        modelUsed,
        promptVersion: GEMINI_PROMPT_VERSION,
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      };
    }
  }
}

// Test provider for use in tests only — clearly marked as test-only.
// Never used in production. Injected via dependency injection.
export class TestExtractionProvider implements IExtractionProvider {
  private available: boolean;
  private responseText: string | null;
  private throwError: string | null;

  constructor(opts: {
    available?: boolean;
    responseText?: string | null;
    throwError?: string | null;
  } = {}) {
    this.available = opts.available ?? true;
    this.responseText = opts.responseText ?? null;
    this.throwError = opts.throwError ?? null;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async extract(_request: ExtractionRequest, _config?: GeminiServiceConfig): Promise<ExtractionServiceResult> {
    const modelUsed = "test-provider";
    const promptVersion = GEMINI_PROMPT_VERSION;
    const extractionSchemaVersion = EXTRACTION_SCHEMA_VERSION;

    if (!this.available) {
      return {
        success: false,
        error: classifyMissingCredentials(),
        modelUsed,
        promptVersion,
        extractionSchemaVersion,
      };
    }

    if (this.throwError) {
      return {
        success: false,
        error: classifyModelRequestFailed(this.throwError),
        modelUsed,
        promptVersion,
        extractionSchemaVersion,
      };
    }

    if (this.responseText === null) {
      return {
        success: false,
        error: classifyMalformedJson("No response text configured"),
        modelUsed,
        promptVersion,
        extractionSchemaVersion,
      };
    }

    // Try to parse and validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.responseText);
    } catch (e) {
      return {
        success: false,
        error: classifyMalformedJson((e as Error).message),
        rawResponseText: this.responseText,
        modelUsed,
        promptVersion,
        extractionSchemaVersion,
      };
    }

    const validationResult = safeParseGeminiExtraction(parsed);
    if (!validationResult.ok) {
      return {
        success: false,
        error: classifySchemaValidationFailed(validationResult.error),
        rawResponseText: this.responseText,
        modelUsed,
        promptVersion,
        extractionSchemaVersion,
      };
    }

    const payload = validationResult.data;
    if (payload.people.length === 0) {
      return {
        success: false,
        error: classifyEmptyPeople(),
        rawResponseText: this.responseText,
        payload,
        modelUsed,
        promptVersion,
        extractionSchemaVersion,
      };
    }

    return {
      success: true,
      rawResponseText: this.responseText,
      payload,
      modelUsed,
      promptVersion,
      extractionSchemaVersion,
    };
  }
}

// Prompt builder — imports from prompt.ts
import { buildExtractionPrompt as buildPromptText, GEMINI_PROMPT_VERSION as PROMPT_VER } from "./prompt.js";

// Response schema for Gemini structured output
function buildResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      targetCompanyName: { type: Type.STRING },
      screenshots: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            screenshotId: { type: Type.STRING },
            capturedAt: { type: Type.STRING },
          },
        },
      },
      people: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            personId: { type: Type.STRING },
            name: { type: Type.STRING },
            headline: { type: Type.STRING },
            title: { type: Type.STRING },
            location: { type: Type.STRING },
            connectionDegree: { type: Type.INTEGER },
            currentRoles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  company: { type: Type.STRING },
                  evidenceText: { type: Type.STRING },
                },
              },
            },
            pastRoles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  company: { type: Type.STRING },
                  evidenceText: { type: Type.STRING },
                },
              },
            },
            mutualContacts: {
              type: Type.OBJECT,
              properties: {
                named: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      headline: { type: Type.STRING },
                    },
                  },
                },
                vagueCount: { type: Type.INTEGER },
              },
            },
            sourceScreenshotIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            confidence: { type: Type.NUMBER },
            fieldConfidence: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.NUMBER },
                title: { type: Type.NUMBER },
                location: { type: Type.NUMBER },
                currentRoles: { type: Type.NUMBER },
                mutualContacts: { type: Type.NUMBER },
              },
            },
          },
          propertyOrdering: [
            "personId", "name", "headline", "title", "location",
            "connectionDegree", "currentRoles", "pastRoles",
            "mutualContacts", "sourceScreenshotIds", "confidence", "fieldConfidence",
          ],
        },
      },
      extractionMeta: {
        type: Type.OBJECT,
        properties: {
          provider: { type: Type.STRING },
          providerRunId: { type: Type.STRING },
          overallConfidence: { type: Type.NUMBER },
          extractionWarnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
    propertyOrdering: ["targetCompanyName", "screenshots", "people", "extractionMeta"],
  };
}

// Re-export for prompt version
export { PROMPT_VER as PROMPT_VERSION };
