import type { ChatMessage, ExtractedPreferences, ParsedCV } from '../types';

// --- LLM Config (Anthropic Claude) ---

interface LLMConfig {
  apiKey: string;
}

const LLM_MODEL = 'claude-sonnet-4-20250514';
const LLM_BASE_URL = 'https://api.anthropic.com/v1';

// Check if running in Chrome extension context
const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage?.sync;

function getApiKey(): string | null {
  // First check .env (dev mode)
  const envKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  // Fallback to localStorage
  const item = localStorage.getItem('anthropicApiKey');
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

  // Extract system message for Anthropic format
  const systemMessage = messages.find((m) => m.role === 'system')?.content;
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const response = await fetch(`${LLM_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 1024,
      system: systemMessage,
      messages: chatMessages,
      temperature: options.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new LLMError('Invalid API key', 'INVALID_KEY');
    }
    if (response.status === 429) {
      throw new LLMError('Rate limited', 'RATE_LIMITED');
    }
    throw new LLMError('API request failed', 'API_ERROR');
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
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
    // Build message content based on file type (Anthropic format)
    const messageContent =
      file.type === 'pdf'
        ? [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: file.content,
              },
            },
            { type: 'text', text: CV_PARSE_PROMPT },
          ]
        : [{ type: 'text', text: `${CV_PARSE_PROMPT}\n\nCV Text:\n${file.content.slice(0, 8000)}` }];

    const response = await fetch(`${LLM_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: messageContent }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new LLMError('API request failed', 'API_ERROR');
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '';

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;
    return JSON.parse(jsonStr.trim());
  } catch (err) {
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

