// Supabase Edge Function — AI Chat Proxy
// Routes AI API calls server-side so the API key is never exposed to the browser
// Deploy: supabase functions deploy ai-chat --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { messages, system, model, max_tokens, apiKey } = await req.json()

    const key = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) {
      return new Response(JSON.stringify({ error: 'No AI API key configured' }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5-20250514',
        max_tokens: max_tokens || 1024,
        system: system || '',
        messages,
      }),
    })

    const data = await response.text()
    return new Response(data, {
      status: response.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
