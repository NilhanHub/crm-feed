import { GoogleGenAI } from "@google/genai";
import { createInterface } from "node:readline";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

if (!apiKey) {
  console.log("GEMINI_API_KEY: NOT SET");
  console.log("RESULT: FAIL");
  process.exit(1);
}

const masked = apiKey.length > 8
  ? apiKey.slice(0, 3) + "..." + apiKey.slice(-4)
  : "(masked)";

console.log(`Using model: ${model}`);
console.log(`Key masked: ${masked}`);

try {
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: "Reply with exactly: CRM_FEED_GEMINI_OK" }] }],
  });
  const text = response.text ?? "";
  console.log(`Response: ${text.trim()}`);
  if (text.trim() === "CRM_FEED_GEMINI_OK") {
    console.log("RESULT: PASS");
  } else {
    console.log("RESULT: UNEXPECTED_RESPONSE");
  }
} catch (err) {
  console.log(`Error: ${(err).message}`);
  console.log("RESULT: FAIL");
}
