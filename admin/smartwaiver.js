// ============================================================
// Smartwaiver API helper
// Docs: https://api.smartwaiver.com/docs
//
// IMPORTANT: Your Smartwaiver API key is sensitive — it can read
// ALL your waivers including minors' data. DO NOT ship it in
// this browser-visible JS. Production flow:
//
//   Browser (this file) --> Supabase Edge Function --> Smartwaiver
//                            (key lives here, server-side only)
//
// For development only, you can temporarily put a READ-ONLY key in
// window.APP_CONFIG.smartwaiverDevKey. Delete it before deploying.
// ============================================================

(function(){
  var CFG = (typeof window !== 'undefined' && window.APP_CONFIG) || {};

  // The Edge Function URL we'll call in production.
  // Built later in /supabase/functions/smartwaiver-lookup/
  var EDGE_URL = (CFG.supabaseUrl || '') + '/functions/v1/smartwaiver-lookup';

  // Dev mode (temporary): talk directly to Smartwaiver from browser.
  // Only used if CFG.smartwaiverDevKey is set AND CFG.smartwaiverDevMode === true.
  var SW_API = 'https://api.smartwaiver.com/v4';

  async function callEdge(action, payload){
    var token;
    if(window.supabaseClient){
      var res = await window.supabaseClient.auth.getSession();
      token = res && res.data && res.data.session && res.data.session.access_token;
    }
    var r = await fetch(EDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CFG.supabaseKey,
        'Authorization': 'Bearer '+(token || CFG.supabaseKey)
      },
      body: JSON.stringify({action: action, payload: payload})
    });
    if(!r.ok) throw new Error('Smartwaiver lookup failed: HTTP '+r.status);
    return r.json();
  }

  async function callSmartwaiverDirect(path, params){
    if(!CFG.smartwaiverDevKey) throw new Error('No Smartwaiver dev key configured');
    var qs = params ? '?' + Object.entries(params).map(function(kv){
      return encodeURIComponent(kv[0])+'='+encodeURIComponent(kv[1]);
    }).join('&') : '';
    var r = await fetch(SW_API + path + qs, {
      headers: { 'sw-api-key': CFG.smartwaiverDevKey }
    });
    if(!r.ok) throw new Error('Smartwaiver API failed: HTTP '+r.status);
    return r.json();
  }

  // Pick the right transport based on config
  function call(action, payload){
    if(CFG.smartwaiverDevMode && CFG.smartwaiverDevKey){
      return devDispatch(action, payload);
    }
    return callEdge(action, payload);
  }

  // Dev-mode dispatch: translate our action vocabulary to Smartwaiver API paths
  function devDispatch(action, payload){
    switch(action){
      case 'search':
        return callSmartwaiverDirect('/waivers', {
          fromDts: payload.fromDts || '',
          toDts: payload.toDts || '',
          firstName: payload.firstName || '',
          lastName: payload.lastName || '',
          limit: payload.limit || 20
        });
      case 'get':
        return callSmartwaiverDirect('/waivers/' + payload.waiverId);
      case 'templates':
        return callSmartwaiverDirect('/templates');
      default:
        return Promise.reject(new Error('Unknown Smartwaiver action: '+action));
    }
  }

  // ==========================================================
  // Public API — what the admin UI calls into
  // ==========================================================
  window.Smartwaiver = {

    // Find the most recent signed waiver for a name.
    // Returns { found: bool, waiverId, signedAt, participantName, pdfUrl } or { found: false }.
    findByName: async function(firstName, lastName){
      try {
        var res = await call('search', {firstName: firstName, lastName: lastName, limit: 5});
        var list = (res && res.waivers) || (res && res.data && res.data.waivers) || [];
        if(!list.length) return {found: false};
        var top = list[0];  // API returns most recent first
        return {
          found: true,
          waiverId: top.waiverId,
          signedAt: top.createdOn,
          participantName: [top.firstName, top.lastName].filter(Boolean).join(' '),
          pdfUrl: top.pdf || null
        };
      } catch(e){
        console.error('Smartwaiver.findByName error:', e);
        return {found: false, error: e.message};
      }
    },

    // Fetch full details of one waiver (for archiving the PDF locally)
    get: async function(waiverId){
      return call('get', {waiverId: waiverId});
    },

    // List waiver templates we have (for the setup screen)
    templates: async function(){
      return call('templates', {});
    },

    // Link a Smartwaiver waiver to one of our customers
    // Writes waiver_id + waiver_signed_at + waiver_pdf_url to the customers row
    linkToCustomer: async function(customerId, waiverInfo){
      if(!window.supabaseClient) throw new Error('Supabase client not ready');
      var { data, error } = await window.supabaseClient
        .from('customers')
        .update({
          waiver_id: waiverInfo.waiverId,
          waiver_signed_at: waiverInfo.signedAt,
          waiver_pdf_url: waiverInfo.pdfUrl
        })
        .eq('id', customerId);
      if(error) throw error;
      return data;
    },

    // Used by the check-in screen: does THIS customer have a valid waiver?
    hasValidWaiverFor: async function(customer){
      // Fast path: we already stored the waiver id on the customer row
      if(customer.waiver_id && customer.waiver_signed_at){
        // Optionally check age of waiver — most parks treat waivers as valid for 1 year
        var signedAt = new Date(customer.waiver_signed_at);
        var oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        if(signedAt > oneYearAgo) return {valid: true, reason: 'cached', waiverId: customer.waiver_id};
        // Else expired — fall through to API lookup
      }
      // API lookup by name
      var parts = (customer.name || '').trim().split(/\s+/);
      var first = parts[0] || '';
      var last = parts.slice(1).join(' ') || '';
      if(!first || !last) return {valid: false, reason: 'no_name'};
      var lookup = await this.findByName(first, last);
      if(!lookup.found) return {valid: false, reason: 'not_on_file'};
      // Found — link to customer for next time
      await this.linkToCustomer(customer.id, lookup);
      return {valid: true, reason: 'linked', waiverId: lookup.waiverId};
    }

  };
})();
