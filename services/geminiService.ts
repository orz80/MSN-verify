import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult } from "../types";

let currentKeyIndex = 0;
let lastApiKeyString = '';
let parsedKeys: string[] = [];

// Helper to get the next client in rotation based on provided key string
const getNextClient = (apiKeyString: string): GoogleGenAI | null => {
  if (!apiKeyString) return null;

  // If keys changed, re-parse and reset index
  if (apiKeyString !== lastApiKeyString) {
    parsedKeys = apiKeyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    lastApiKeyString = apiKeyString;
    currentKeyIndex = 0;
  }

  if (parsedKeys.length === 0) return null;
  
  const key = parsedKeys[currentKeyIndex];
  // Move index for next time (Round Robin)
  currentKeyIndex = (currentKeyIndex + 1) % parsedKeys.length;
  
  return new GoogleGenAI({ apiKey: key });
};

export const checkFrameForTarget = async (
  apiKeyString: string,
  targetImagesBase64: string[],
  screenFrameBase64: string
): Promise<DetectionResult> => {
  const ai = getNextClient(apiKeyString);

  if (!ai) {
    console.error("No API Keys provided.");
    return { detected: false, confidence: 0 };
  }

  // Robust parsing of Data URL to ensure we correctly strip headers
  const parseDataUrl = (url: string) => {
    try {
      // Data URLs are formatted as: data:[<mediatype>][;base64],<data>
      // We look for the first comma to separate metadata from data.
      const commaIndex = url.indexOf(',');
      if (commaIndex === -1) return null;

      const metadata = url.substring(0, commaIndex);
      const data = url.substring(commaIndex + 1);

      // Extract mime type from metadata (e.g., "data:image/png;base64")
      const mimeMatch = metadata.match(/^data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

      // Clean the base64 data: remove any whitespace or newlines that might cause invalid argument errors
      const cleanData = data.replace(/[\s\r\n]+/g, '');

      if (cleanData.length === 0) return null;

      return { mimeType, data: cleanData };
    } catch (e) {
      console.error("Failed to parse Data URL", e);
      return null;
    }
  };

  const targets = targetImagesBase64.map(img => parseDataUrl(img)).filter((t): t is { mimeType: string, data: string } => t !== null);
  const screen = parseDataUrl(screenFrameBase64);

  if (targets.length === 0 || !screen) {
    console.warn("Invalid image data provided (failed to parse Data URL or empty data).");
    return { detected: false, confidence: 0 };
  }

  try {
    const parts: any[] = [];
    
    // Add all target images as separate parts
    targets.forEach(target => {
      parts.push({
        inlineData: {
          mimeType: target.mimeType,
          data: target.data
        }
      });
    });

    // Add the screen frame as the last image part
    parts.push({
      inlineData: {
        mimeType: screen.mimeType,
        data: screen.data
      }
    });

    // Add text prompt
    parts.push({
      text: `Analyze the images provided above.
The first ${targets.length} image(s) are 'Target Patterns' (e.g., buttons, icons, characters).
The LAST image is the 'Game Screen'.

YOUR TASK:
Determine if ANY of the 'Target Patterns' are strictly visible in the 'Game Screen'.

STRICT RULES FOR DETECTION:
1. **Exact Visual Match**: The object in the Game Screen must match the Target Pattern EXACTLY in terms of shape, iconography, and internal details.
   - REJECT objects that merely look similar (e.g., wrong color, wrong symbol, different button).
   - REJECT matches if the resolution makes it ambiguous.
2. **Game UI Context**: Treat this as a game automation task. False positives cause automation failures. It is better to return 'false' than to guess wrong.
3. **Consistency**: If the screen is black, blurry, or transitioning, return detected: false.
4. **Bounding Box**: If found, you MUST provide a precise bounding box.

OUTPUT FORMAT (JSON):
{
  "detected": boolean,
  "confidence": number (0.0 to 1.0, be conservative),
  "box_2d": [ymin, xmin, ymax, xmax] (normalized 0-1)
}`
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: {
        parts: parts
      },
      config: {
        temperature: 0.0, // Zero temperature for maximum determinism
        systemInstruction: "You are a rigid visual verification system. You reject any detection that is not a near-perfect match to the reference image.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            confidence: { type: Type.NUMBER },
            box_2d: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: "Bounding box coordinates [ymin, xmin, ymax, xmax] (normalized 0-1). ymin is top, xmin is left."
            }
          },
          required: ["detected", "confidence"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      console.warn("Empty response from Gemini");
      return { detected: false, confidence: 0 };
    }

    const json = JSON.parse(resultText);
    
    let boundingBox = undefined;
    if (json.box_2d && Array.isArray(json.box_2d) && json.box_2d.length === 4) {
      // Validate coordinates are within 0-1
      const [ymin, xmin, ymax, xmax] = json.box_2d;
      if (ymin >= 0 && ymin <= 1 && xmin >= 0 && xmin <= 1) {
        boundingBox = {
          ymin: ymin,
          xmin: xmin,
          ymax: ymax,
          xmax: xmax
        };
      }
    }

    return {
      detected: !!json.detected,
      confidence: Number(json.confidence) || 0,
      boundingBox
    };

  } catch (error: any) {
    console.error("Gemini Detection Error:", error);
    // Return a safe default so the app doesn't crash on transient API errors
    return { detected: false, confidence: 0 };
  }
};