'use strict';
const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const axios   = require('axios');

// ── Agent system prompt ─────────────────────
const AGENT_PROMPT = `You are DK Agent, a powerful
AI assistant for Dipesh Karki's portfolio website.

You have multiple capabilities:
1. ANSWER questions about services and pricing
2. COLLECT project requirements from users
3. GENERATE price quotes based on requirements
4. GUIDE users through hiring process
5. EXPLAIN ForexAI Terminal features

About Dipesh Karki:
  Full Stack Developer from Nepal
  Specializes in AI systems and trading tech
  Built ForexAI Terminal — live AI trading platform
  BCA Graduate — available for freelance worldwide

SERVICES AND PRICES:
  AI Trading Dashboard:  $299  — 14 days
  Telegram Signal Bot:   $150  — 7 days
  Full Stack Web App:    $200+ — 10 days
  AI API Integration:    $100+ — 5 days
  Forex Signal System:   $199  — 7 days
  Professional Landing:  $80   — 3 days
  AI Rapper Guide PDF:   $9.99 — instant

PAYMENT:
  Fiverr: https://www.fiverr.com/sellers/lunna112
  PayPal: dipeshkarki8292@gmail.com
  Ko-fi:  https://ko-fi.com/dipeshkarki

CONTACT: dipeshkarki6612@gmail.com
FOREXAI: https://ai-forex-frontend.onrender.com
GITHUB:  https://github.com/lunnar211

AGENT TOOLS YOU CAN USE:
  When user wants to hire → collect: name, email,
  project type, budget, timeline, description
  Then confirm details and submit hire form

  When user asks price → calculate based on:
  Basic site = $80-200
  Complex app = $200-500
  AI integration = $100-300
  Full platform = $299-500+

PERSONALITY:
  Warm, helpful, professional
  Short responses for voice (2-3 sentences)
  Guide users step by step
  Never say you cannot help
  Always offer next action

RESPONSE FORMAT FOR ACTIONS:
  If you detect user wants to hire include at end:
  [ACTION:show_hire_form]

  If user asks to see portfolio:
  [ACTION:scroll_to_projects]

  If user asks about ForexAI demo:
  [ACTION:open_demo]

  If user is ready to pay:
  [ACTION:show_payment]`;

// ── Intent detector ─────────────────────────
function detectIntent(message) {
  const msg = message.toLowerCase();
  // Check pricing before hire to avoid false positives
  // e.g. "I want to know the price" → pricing, not hire
  if (msg.match(/\b(price|cost|how much|budget|charge)\b/))
    return 'pricing';
  if (msg.match(/\b(hire|build|develop|create|make)\b/))
    return 'hire';
  if (msg.match(/\b(forex|trading|signal|prediction)\b/))
    return 'forexai';
  if (msg.match(/\b(pay|paypal|fiverr|payment)\b/))
    return 'payment';
  if (msg.match(/\b(contact|email|reach|talk)\b/))
    return 'contact';
  return 'general';
}

// ── Groq (primary — fastest) ────────────────
async function askGroq(messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('No GROQ_API_KEY');
  }
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY.trim(),
  });
  const res = await groq.chat.completions.create({
    model:       'llama-3.3-70b-versatile',
    max_tokens:  200,
    temperature: 0.75,
    messages,
  });
  return res.choices[0].message.content;
}

// ── HuggingFace backup ──────────────────────
async function askHuggingFace(messages) {
  if (!process.env.HUGGINGFACE_API_KEY) {
    throw new Error('No HUGGINGFACE_API_KEY');
  }
  const res = await axios.post(
    'https://api-inference.huggingface.co/' +
    'models/Qwen/Qwen2.5-7B-Instruct/' +
    'v1/chat/completions',
    {
      model:      'Qwen/Qwen2.5-7B-Instruct',
      max_tokens: 200,
      stream:     false,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return res.data?.choices?.[0]?.message?.content
    || 'Please try again.';
}

// ── Gemini backup ───────────────────────────
async function askGemini(userMessage, systemPrompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('No GEMINI_API_KEY');
  }
  const { GoogleGenerativeAI } = require(
    '@google/generative-ai'
  );
  const genAI = new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY.trim()
  );
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
  });
  const result = await model.generateContent(
    systemPrompt + '\n\nUser: ' + userMessage
  );
  return result.response.text();
}

// ── Parse action tags from response ─────────
function parseResponse(rawText) {
  const actions = [];
  const actionPattern = /\[ACTION:(\w+)\]/g;
  let match;
  while ((match = actionPattern.exec(rawText)) !== null) {
    actions.push(match[1]);
  }
  const cleanText = rawText
    .replace(/\[ACTION:\w+\]/g, '')
    .trim();
  return { text: cleanText, actions };
}

// ── Main agent endpoint ──────────────────────
// POST /api/assistant/chat
router.post('/chat', async (req, res) => {
  try {
    const {
      message,
      history     = [],
      sessionData = {},
    } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({
        error: 'Message required',
      });
    }

    const intent = detectIntent(message);

    // Build messages array for LLM
    const messages = [
      { role: 'system', content: AGENT_PROMPT },
      ...history.slice(-10), // last 10 for context
      { role: 'user', content: message.trim() },
    ];

    let rawResponse = null;
    let provider    = null;

    // Try providers in order
    const providers = [
      {
        name: 'groq',
        fn: () => askGroq(messages),
      },
      {
        name: 'huggingface',
        fn: () => askHuggingFace(messages),
      },
      {
        name: 'gemini',
        fn: () => askGemini(
          message.trim(), AGENT_PROMPT
        ),
      },
    ];

    for (const p of providers) {
      try {
        rawResponse = await p.fn();
        provider    = p.name;
        if (rawResponse) break;
      } catch (err) {
        console.warn(
          `[Agent] ${p.name} failed:`,
          err.message.slice(0, 80)
        );
      }
    }

    if (!rawResponse) {
      return res.status(503).json({
        error: 'AI temporarily unavailable. ' +
               'Please try again in a moment.',
      });
    }

    const { text, actions } = parseResponse(
      rawResponse
    );

    res.json({
      success:     true,
      response:    text,
      provider,
      intent,
      actions,
      sessionData,
    });

  } catch (err) {
    console.error('[Agent] Error:', err.message);
    res.status(500).json({
      error: 'Agent error. Please try again.',
    });
  }
});

// ── Streaming endpoint for real-time response ─
// POST /api/assistant/stream
router.post('/stream', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({
      error: 'Message required',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('No GROQ key');
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY.trim(),
    });

    const stream = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      max_tokens:  200,
      stream:      true,
      messages: [
        { role: 'system', content: AGENT_PROMPT },
        ...history.slice(-8),
        { role: 'user', content: message.trim() },
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta
        ?.content || '';
      if (text) {
        res.write(
          `data: ${JSON.stringify({ text })}\n\n`
        );
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    res.write(
      `data: ${JSON.stringify({
        error: err.message,
      })}\n\n`
    );
    res.end();
  }
});

module.exports = router;
