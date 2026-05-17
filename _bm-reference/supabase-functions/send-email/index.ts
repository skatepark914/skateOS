// Supabase Edge Function — SendGrid Email Proxy
// Solves CORS: browser → this function → SendGrid API
// Deploy: supabase functions deploy send-email --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { to, subject, html, text, from, replyTo, apiKey } = await req.json()

    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, html or text' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Use provided API key or fall back to environment variable
    const sgKey = apiKey || Deno.env.get('SENDGRID_API_KEY')
    if (!sgKey) {
      return new Response(JSON.stringify({ error: 'No SendGrid API key configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const fromEmail = from || 'info@peekskilltree.com'
    const fromName = 'Second Nature Tree Service'

    const sgPayload = {
      personalizations: [{ to: Array.isArray(to) ? to.map((e: string) => ({ email: e })) : [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      ...(replyTo ? { reply_to: { email: replyTo } } : {}),
      subject,
      content: [
        ...(html ? [{ type: 'text/html', value: html }] : []),
        ...(text ? [{ type: 'text/plain', value: text }] : []),
      ],
    }

    const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sgKey}`,
      },
      body: JSON.stringify(sgPayload),
    })

    if (sgResponse.ok || sgResponse.status === 202) {
      return new Response(JSON.stringify({ success: true, status: sgResponse.status }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const errText = await sgResponse.text()
    return new Response(JSON.stringify({ error: 'SendGrid error', status: sgResponse.status, details: errText }), {
      status: sgResponse.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
