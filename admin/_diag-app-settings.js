// Open admin in browser, log in, then in DevTools Console run:
//   await fetch('/_diag-app-settings.js').then(r=>r.text()).then(eval)
// Output appears in the Console — copy it back to chat.

(async () => {
  const r = await fetch(SB + '/rest/v1/app_settings?select=key,value,updated_at', {
    headers: { apikey: KEY, Authorization: 'Bearer ' + authToken }
  });
  const rr = await r.json();

  const w = await fetch(SB + '/rest/v1/app_settings?on_conflict=key', {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + authToken,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({ key: '_diag', value: { ts: Date.now() } })
  });
  const wb = await w.text();

  const m = await fetch(SB + '/rest/v1/staff?id=eq.' + currentUser.id + '&select=id,email,role,active', {
    headers: { apikey: KEY, Authorization: 'Bearer ' + authToken }
  });
  const mr = await m.json();

  console.log('=== READ ===', r.status, 'rows:', rr.length, rr);
  console.log('=== WRITE ===', w.status, wb);
  console.log('=== ME ===', mr);
  return { readStatus: r.status, writeStatus: w.status, rowCount: rr.length, me: mr[0] || null };
})();
