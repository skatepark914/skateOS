// ============================================================
// Email Templates — white-labeled via window.APP_CONFIG
// Ready for Resend / Postmark / SendGrid integration
// ============================================================

(function(){
  var CFG = (typeof window !== 'undefined' && window.APP_CONFIG) || {};

  function brandHeader(){
    var logo = CFG.logoEmoji || '🛹';
    var name = CFG.bizShortName || CFG.bizName || 'Park';
    var accent = CFG.bizShortAccent ? ' '+CFG.bizShortAccent : '';
    var color = CFG.themeColor || '#e11d48';
    return ''
      + '<div style="background:#1a1a1a;padding:24px 32px;text-align:center;">'
      +   '<div style="color:'+color+';font-size:1.4rem;font-weight:800;">'+logo+' '+name+accent+'</div>'
      + '</div>';
  }

  function brandFooter(){
    var parts = [CFG.bizName, CFG.bizWebsite].filter(Boolean).join(' — ');
    var contact = [CFG.bizPhone, CFG.bizEmail].filter(Boolean).join(' — ');
    return ''
      + '<div style="background:#1a1a1a;padding:20px 32px;text-align:center;">'
      +   '<div style="color:#999;font-size:.75rem;">'+parts+(contact?'<br>'+contact:'')+'</div>'
      + '</div>';
  }

  function shell(body){
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>'
      + '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;background:#f4f4f4;">'
      +   '<div style="max-width:600px;margin:0 auto;background:#fff;">'
      +     brandHeader()
      +     '<div style="padding:32px;">' + body + '</div>'
      +     brandFooter()
      +   '</div>'
      + '</body></html>';
  }

  function money(n){ return '$' + Number(n||0).toFixed(2); }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  window.EmailTemplates = {

    // Day-pass / retail receipt
    orderConfirmation: function(data){
      var items = (data.items||[]).map(function(i){
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">'
          + '<span>'+esc(i.name)+' × '+(i.qty||1)+'</span>'
          + '<span style="font-weight:700;">'+money((i.price||0)*(i.qty||1))+'</span></div>';
      }).join('');
      var themeColor = CFG.themeColor || '#e11d48';
      var body = ''
        + '<h1 style="font-size:1.5rem;margin:0 0 8px;">Thanks for skating!</h1>'
        + '<p style="color:#666;margin:0 0 24px;">Hi '+esc(data.customerName||'there')+', here\'s your receipt.</p>'
        + '<div style="background:#f9fafb;border-radius:8px;padding:20px;margin-bottom:24px;">'
        +   '<div style="font-size:.8rem;color:#999;margin-bottom:8px;">Receipt: '+esc(data.receiptNumber||'')+'</div>'
        +   items
        +   '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:.9rem;"><span>Subtotal</span><span>'+money(data.subtotal)+'</span></div>'
        +   '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:.9rem;"><span>Tax</span><span>'+money(data.tax)+'</span></div>'
        +   '<div style="display:flex;justify-content:space-between;padding:12px 0 0;font-size:1.2rem;font-weight:800;border-top:2px solid #1a1a1a;"><span>Total</span><span style="color:'+themeColor+';">'+money(data.total)+'</span></div>'
        + '</div>'
        + (CFG.bizPhone ? '<p style="color:#666;font-size:.85rem;">Questions? Call <a href="tel:'+esc(CFG.bizPhone)+'" style="color:'+themeColor+';">'+esc(CFG.bizPhone)+'</a> or reply to this email.</p>' : '');
      return {
        subject: (CFG.bizName||'Park') + ' — Receipt ' + (data.receiptNumber||''),
        html: shell(body)
      };
    },

    // Invoice with hosted-pay link (Helcim)
    invoiceSend: function(data){
      var themeColor = CFG.themeColor || '#e11d48';
      var body = ''
        + '<h1 style="font-size:1.5rem;margin:0 0 8px;">Invoice '+esc(data.invoiceNumber||'')+'</h1>'
        + '<p style="color:#666;margin:0 0 24px;">Hi '+esc(data.customerName||'there')+', here\'s your invoice.</p>'
        + '<div style="background:#f9fafb;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">'
        +   '<div style="font-size:2.5rem;font-weight:900;color:'+themeColor+';">'+money(data.total)+'</div>'
        +   '<div style="color:#666;margin-top:4px;">Due by '+esc(data.dueDate||'upon receipt')+'</div>'
        + '</div>'
        + (data.paymentLink
            ? '<a href="'+esc(data.paymentLink)+'" style="display:block;background:'+themeColor+';color:#fff;text-align:center;padding:16px;border-radius:10px;font-weight:700;font-size:1.1rem;text-decoration:none;margin-bottom:24px;">Pay Now — Secure Checkout</a>'
            : '')
        + (CFG.bizPhone ? '<p style="color:#666;font-size:.85rem;">Questions? Call '+esc(CFG.bizPhone)+' or reply to this email.</p>' : '');
      return {
        subject: 'Invoice ' + (data.invoiceNumber||'') + ' — ' + (CFG.bizName||'Park'),
        html: shell(body)
      };
    },

    // New membership welcome
    memberWelcome: function(data){
      // data: {customerName, planName, planType, punchesTotal, startDate, endDate, memberCardUrl}
      var themeColor = CFG.themeColor || '#e11d48';
      var body = ''
        + '<h1 style="font-size:1.5rem;margin:0 0 8px;">Welcome to the park! 🛹</h1>'
        + '<p style="color:#666;margin:0 0 24px;">Hi '+esc(data.customerName||'there')+', you\'re all set.</p>'
        + '<div style="background:#f9fafb;border-radius:8px;padding:20px;margin-bottom:24px;">'
        +   '<div style="font-size:.8rem;color:#999;margin-bottom:4px;">YOUR PLAN</div>'
        +   '<div style="font-size:1.2rem;font-weight:800;">'+esc(data.planName||'Membership')+'</div>'
        +   (data.planType==='punch_card' && data.punchesTotal
              ? '<div style="margin-top:8px;color:#666;">'+data.punchesTotal+' sessions available</div>'
              : '')
        +   (data.startDate ? '<div style="margin-top:8px;color:#666;">Starts '+esc(data.startDate)+(data.endDate?' → '+esc(data.endDate):'')+'</div>' : '')
        + '</div>'
        + (data.memberCardUrl
            ? '<a href="'+esc(data.memberCardUrl)+'" style="display:block;background:'+themeColor+';color:#fff;text-align:center;padding:16px;border-radius:10px;font-weight:700;font-size:1.1rem;text-decoration:none;margin-bottom:24px;">Get Your Member Card</a>'
            : '')
        + '<p style="color:#666;font-size:.85rem;">See you at the park. Questions? Hit reply anytime.</p>';
      return {
        subject: 'Welcome to ' + (CFG.bizName||'the park') + '!',
        html: shell(body)
      };
    },

    // Lesson / birthday / camp booking reminder
    bookingReminder: function(data){
      // data: {customerName, type, instructor, scheduledAt, durationMin}
      var themeColor = CFG.themeColor || '#e11d48';
      var typeLabel = {private:'Private lesson',group:'Group lesson',camp:'Skate camp',birthday:'Birthday party',event:'Event'}[data.type] || 'Session';
      var body = ''
        + '<h1 style="font-size:1.5rem;margin:0 0 8px;">Reminder: '+esc(typeLabel)+'</h1>'
        + '<p style="color:#666;margin:0 0 24px;">Hi '+esc(data.customerName||'there')+', see you soon.</p>'
        + '<div style="background:#f9fafb;border-radius:8px;padding:20px;">'
        +   '<div style="margin-bottom:8px;"><strong>When:</strong> '+esc(data.scheduledAt||'')+'</div>'
        +   (data.durationMin ? '<div style="margin-bottom:8px;"><strong>Duration:</strong> '+data.durationMin+' min</div>' : '')
        +   (data.instructor ? '<div style="margin-bottom:8px;"><strong>Instructor:</strong> '+esc(data.instructor)+'</div>' : '')
        + '</div>'
        + '<p style="color:#666;font-size:.85rem;margin-top:24px;">Need to reschedule? Reply to this email or call '+esc(CFG.bizPhone||'')+'.</p>';
      return {
        subject: 'Reminder: ' + typeLabel + ' — ' + (CFG.bizName||'Park'),
        html: shell(body)
      };
    }

  };
})();
