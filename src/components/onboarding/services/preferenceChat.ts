import type { ChatMessage, ExtractedPreferences, ParsedCV } from '../types';

// --- LLM Config (Google Gemini) ---

const LLM_MODEL = 'gemini-2.0-flash';
const LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function getApiKey(): string | null {
  // First check .env (dev mode)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey) return envKey;

  // Fallback to localStorage
  const item = localStorage.getItem('geminiApiKey');
  return item || null;
}

class LLMError extends Error {
  constructor(
    message: string,
    public code: 'NO_API_KEY' | 'INVALID_KEY' | 'RATE_LIMITED' | 'API_ERROR'
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

async function chatWithLLM(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number } = {}
): Promise<string> {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new LLMError('No API key configured', 'NO_API_KEY');
  }

  // Extract system message for Gemini format
  const systemMessage = messages.find((m) => m.role === 'system')?.content;
  
  // Convert messages to Gemini format
  const geminiContents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const response = await fetch(
    `${LLM_BASE_URL}/models/${LLM_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: systemMessage ? { parts: [{ text: systemMessage }] } : undefined,
        contents: geminiContents,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new LLMError('Invalid API key', 'INVALID_KEY');
    }
    if (response.status === 429) {
      throw new LLMError('Rate limited', 'RATE_LIMITED');
    }
    throw new LLMError('API request failed', 'API_ERROR');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// --- CV Parsing ---

const CV_PARSE_PROMPT = `Parse this CV/resume and extract structured information.

Return only valid JSON:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "phone number",
  "location": "City, Country",
  "summary": "Brief professional summary (1-2 sentences)",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": [
    { "title": "Job Title", "company": "Company Name", "duration": "2020-2023" }
  ],
  "education": [
    { "degree": "Degree Name", "institution": "School Name", "year": "2020" }
  ]
}

Extract the most important information. Keep skills to top 10 max. Keep experience to last 3-4 roles.`;

interface FileInput {
  type: 'text' | 'pdf';
  content: string; // raw text or base64
}

export async function parseCV(file: FileInput): Promise<ParsedCV> {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new LLMError('No API key configured', 'NO_API_KEY');
  }

  try {
    // Build message content based on file type (Gemini format)
    const parts =
      file.type === 'pdf'
        ? [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: file.content,
              },
            },
            { text: CV_PARSE_PROMPT },
          ]
        : [{ text: `${CV_PARSE_PROMPT}\n\nCV Text:\n${file.content.slice(0, 8000)}` }];

    const response = await fetch(
      `${LLM_BASE_URL}/models/${LLM_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('CV parse API error:', response.status, errorData);
      throw new LLMError('API request failed', 'API_ERROR');
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Try to extract JSON from response
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;
    
    // Clean up and parse
    const cleanJson = jsonStr.trim().replace(/^[^{]*/, '').replace(/[^}]*$/, '');
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error('CV parse error:', err);
    if (err instanceof LLMError) throw err;
    // Return minimal parsed data if LLM fails
    return {
      name: 'Could not parse',
      skills: [],
      experience: [],
      education: [],
    };
  }
}

// --- Chat ---

const CHAT_SYSTEM_PROMPT = `You are a helpful job search assistant. The user uploaded their CV and you're helping define job preferences.

Ask about: roles, location (remote/hybrid/cities), salary, company size, industries, dealbreakers.

Keep responses short (2-3 sentences). After 2-3 exchanges, suggest starting the search.

CV Summary:
{cvSummary}`;

export async function getAIResponse(
  messages: ChatMessage[],
  cvText: string
): Promise<string> {
  const systemPrompt = CHAT_SYSTEM_PROMPT.replace(
    '{cvSummary}',
    cvText.slice(0, 1500)
  );

  return chatWithLLM([
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]);
}

// --- Extraction ---

const EXTRACTION_PROMPT = `Extract job preferences from this conversation as JSON.

Conversation:
{conversation}

Return only valid JSON:
{
  "roles": ["job titles"],
  "locations": [{ "type": "remote|onsite|hybrid", "location": "city if applicable" }],
  "salary": { "min": number, "currency": "USD" },
  "companySize": ["startup", "mid", "enterprise"],
  "industries": ["industries"],
  "dealbreakers": ["things to avoid"],
  "mustHaves": ["requirements"]
}

Omit empty fields. Return {} if nothing extractable.`;

export async function extractPreferences(
  messages: ChatMessage[]
): Promise<ExtractedPreferences> {
  const conversation = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const response = await chatWithLLM(
      [
        {
          role: 'user',
          content: EXTRACTION_PROMPT.replace('{conversation}', conversation),
        },
      ],
      { temperature: 0.1 }
    );

    // Handle markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    return JSON.parse(jsonStr.trim());
  } catch {
    return { roles: [], locations: [] };
  }
}

// --- Fallback ---

export function getFallbackResponse(messageCount: number): string {
  const responses = [
    "Got it! Any specific companies you'd love to work for, or want to avoid?",
    "Perfect. Anything else? Otherwise, we can start searching!",
    "Great! Click 'Ready to Start Searching' when you're ready.",
  ];
  return responses[Math.min(Math.floor(messageCount / 2), responses.length - 1)];
}

export { LLMError };

