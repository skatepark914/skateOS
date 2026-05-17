// ============================================================
// WHITE-LABEL CONFIG  (defaults — Settings page overlays these)
// Edit this file to rebrand the admin for any shop/park.
// Loaded before index.html's main script, so every reference
// to window.APP_CONFIG.* picks up these values.
// Per-deployment runtime overrides save to localStorage key
// `skateos_settings` (and Supabase app_settings table once
// migration 004 ships).
// ============================================================
window.APP_CONFIG = {
  // --- Product (software brand — constant across all deployments) ---
  appProductName:    'SkateOS',
  appProductTagline: 'The operating system for skate parks.',
  appProductUrl:     'skateos.com',     // register ASAP — see README

  // --- Deployment (this park's brand — varies per customer) ---
  bizName:        '2nd Nature Park',
  bizShortName:   '2nd Nature',          // shown in sidebar, split-styled
  bizShortAccent: 'Park',                // accent-colored tail (e.g. "2nd Nature Park")
  bizTagline:     'PARK OPERATIONS',      // sidebar subtitle (uppercase)
  logoEmoji:      '🛹',                   // fallback icon if no image
  logoUrl:        '',                     // optional image path
  themeColor:     '#e11d48',              // primary accent (rose-600)
  themeColorDark: '#be123c',
  themeColorLight:'#ffe4e6',

  // --- Contact ---
  bizPhone:       '(914) 402-4624',
  bizEmail:       'info@2ntr.com',
  bizAddr:        '1 Highland Industrial Park, Peekskill, NY 10566',
  bizWebsite:     '2ntr.com',
  bizInstagram:   '@2ndnaturepark',
  receiptFooter:  'Thanks for skating with us!',

  // --- Hours (24h, blank = closed that day) ---
  hours: {
    mon: {open:'15:00', close:'21:00'},
    tue: {open:'15:00', close:'21:00'},
    wed: {open:'15:00', close:'21:00'},
    thu: {open:'15:00', close:'21:00'},
    fri: {open:'14:00', close:'22:00'},
    sat: {open:'10:00', close:'22:00'},
    sun: {open:'10:00', close:'20:00'},
  },

  // --- Financial ---
  taxRate:        0.08375,                // Westchester County NY
  currency:       'USD',
  currencySymbol: '$',

  // --- Backend (Supabase) ---
  supabaseUrl:  'https://zecurmlenxyxanqucrga.supabase.co',
  supabaseKey:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplY3VybWxlbnh5eGFucXVjcmdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTUzMjIsImV4cCI6MjA5MzAzMTMyMn0.PtW3hxsok3ZUw0CFdB7aysnJ2UFkwltHq2Bt1Pw-hK8',

  // --- Payments (Helcim) ---
  // Helcim Smart Terminal in-person + Helcim Pay invoice links remote.
  // The actual API token never lives in the browser — it's a Supabase
  // Edge Function secret (HELCIM_API_TOKEN). These knobs just steer UI.
  paymentProvider:  'helcim',             // 'helcim' | 'square' | 'stripe' (legacy)
  helcimMerchantId: '',                   // shown for support / receipts
  helcimTerminalId: '',                   // physical terminal at the front desk
  helcimLocationId: '',                   // for multi-location bookkeeping

  // --- Integrations (status surfaced in Settings; secrets live in Edge Functions) ---
  integrations: {
    smartwaiver: {
      enabled:       true,
      // Dev-only escape hatch — sends key from browser. NEVER deploy with this true.
      devMode:       false,
      devKey:        '',
      // The webhook URL Smartwaiver should POST to. Read-only, derived from supabaseUrl.
      webhookPath:   '/functions/v1/smartwaiver-webhook',
    },
    resend: {                              // transactional email
      enabled:       false,
      fromAddress:   'info@2ntr.com',
      fromName:      '2nd Nature Park',
    },
    twilio: {                              // SMS
      enabled:       false,
      fromNumber:    '',
    },
    helcim: {
      enabled:       false,                // flips true once Edge Function deploys
    },
  },

  // --- Feature flags (live-toggleable from Settings → Feature Flags) ---
  features: {
    memberships:     true,    // monthly/annual skate passes
    sessionPasses:   true,    // day passes / punch cards
    rentals:         true,    // board/pad rentals at the desk
    lessons:         true,    // booked lessons
    parties:         true,    // birthday party bookings
    shop:            true,    // retail POS
    service:         false,   // board-repair tickets — off by default (was mower-shaped)
    onlineShop:      false,   // customer-facing storefront — v2
    giftCards:       true,    // sell + redeem at POS, public balance check at /admin/gift-card.html
    warranties:      false,   // skate products rarely carry warranty
  },

  // --- Receipts / printing ---
  receipts: {
    showLogo:        true,
    showAddress:     true,
    showTaxId:       false,
    taxIdLabel:      '',
    taxIdValue:      '',
    paperWidth:      '80mm',                // '58mm' | '80mm' | 'letter'
  },

  // --- Categories (seed data for fresh install) ---
  defaultCategories: [
    'Session Passes',
    'Memberships',
    'Lessons',
    'Decks',
    'Trucks',
    'Wheels',
    'Bearings',
    'Hardware',
    'Grip Tape',
    'Shoes',
    'Apparel',
    'Safety Gear',
    'Rentals',
    'Food & Drink',
  ],
};
