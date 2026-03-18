'use strict';
const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const axios   = require('axios');

const SYSTEM_PROMPT = `You are DK Assistant,
the AI helper for Dipesh Karki portfolio.
Dipesh is a Full Stack Developer from Nepal.

Services:
- AI Trading Dashboard: $299
- Telegram Signal Bot: $150
- Full Stack Web App: from $200
- AI Integration: from $100
- Landing Page: $80
- AI Rapper PDF: $9.99

Payment:
- Fiverr: https://www.fiverr.com/sellers/lunna112
- PayPal: dipeshkarki8292@gmail.com
- Ko-fi: https://ko-fi.com/dipeshkarki

Contact: dipeshkarki6612@gmail.com
ForexAI demo: https://ai-forex-frontend.onrender.com

Rules:
- Keep responses SHORT (2-3 sentences max)
- Be friendly and professional
- Guide to hire form or Fiverr when asked
- Give exact prices when asked
- No markdown in responses`;

// Primary: Groq (fastest + free)
async function askGroq(message, history) {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
  });
  const res = await groq.chat.completions.create({
    model:       'llama-3.1-8b-instant',
    max_tokens:  150,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6),
      { role: 'user', content: message },
    ],
  });
  return res.choices?.[0]?.message?.content
    || 'Sorry, try again!';
}

// Fallback: HuggingFace Qwen2.5-7B (22M downloads)
async function askHuggingFace(message, history) {
  const res = await axios.post(
    'https://api-inference.huggingface.co/models/' +
    'Qwen/Qwen2.5-7B-Instruct/v1/chat/completions',
    {
      model: 'Qwen/Qwen2.5-7B-Instruct',
      max_tokens: 150,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-4),
        { role: 'user', content: message },
      ],
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return res.data?.choices?.[0]?.message?.content
    || 'Sorry, try again!';
}

router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({
        error: 'Message required'
      });
    }

    let response;
    let provider;

    // Try Groq first (fastest)
    if (process.env.GROQ_API_KEY) {
      try {
        response = await askGroq(message, history);
        provider = 'groq';
      } catch (err) {
        console.warn('[Assistant] Groq failed:',
          err.message);
      }
    }

    // Fallback to HuggingFace
    if (!response && process.env.HUGGINGFACE_API_KEY) {
      try {
        response = await askHuggingFace(
          message, history
        );
        provider = 'huggingface';
      } catch (err) {
        console.warn('[Assistant] HF failed:',
          err.message);
      }
    }

    if (!response) {
      return res.status(503).json({
        error: 'AI service temporarily unavailable'
      });
    }

    res.json({
      success:  true,
      response,
      provider,
    });

  } catch (err) {
    console.error('[Assistant]', err.message);
    res.status(500).json({
      error: 'Assistant unavailable'
    });
  }
});

module.exports = router;
