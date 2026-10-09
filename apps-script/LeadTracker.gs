/**
 * LEAD TRACKER  ·  TR Lights + Summer-Salt Detailing
 * One free Google Sheet that catches every quote from BOTH websites, then
 * emails you a morning to-do list of who to text. Runs on Google Apps Script.
 * No AI, no paid services.
 *
 * WHAT IT DOES
 *  - Every quote from trlightsnj.com or summersaltdetailing.com becomes a row in
 *    the "Leads" tab, and you get an email right away with a tap-to-text button.
 *  - It records where each lead came from (Facebook ad #, Google, a flyer, direct),
 *    so you can see which ads actually bring in customers.
 *  - Every morning at 8 you get ONE email with ready-to-send texts for:
 *      · quotes that haven't booked yet
 *      · finished jobs that need a Google review request
 *      · detailing customers it's been 6+ weeks since
 *      · lights: early-bird rebooking (Aug 1) and takedown notice (Jan 2)
 *      · a "post your salt-wash special" nudge after snow or heavy rain
 *
 * SETUP: see README.md in this folder (about 10 minutes).
 *
 * DAY TO DAY: keep the Status column current (New > Quoted > Booked > Done, or Lost)
 * and type the Job Date when you book. The morning email does the rest.
 * Leads from calls, Instagram or Nextdoor can be typed in as new rows too.
 */

const CONFIG = {
  ownerName: 'Christian',
  detailingName: 'Summer-Salt',
  lightsName: 'TR Lights',
  // Google Business Profile > "Ask for reviews" > copy link (looks like https://g.page/r/XXXX/review)
  detailingReviewLink: 'PASTE_SUMMER_SALT_REVIEW_LINK',
  lightsReviewLink: 'PASTE_TR_LIGHTS_REVIEW_LINK',
  detailingRebookWeeks: 6,   // nudge detailing customers this many weeks after their last job
  quoteFollowUpDays: 2,      // nudge quotes that haven't booked after this many days
  digestHour: 8,             // morning email time (24h clock, New York time)
  weather: { lat: 39.95, lon: -74.2 } // Toms River
};

const HEADERS = ['Received', 'Business', 'Name', 'Phone', 'Email', 'Town / Address',
  'Details', 'Quote $', 'Status', 'Job Date', 'Texts OK', 'Last Follow-up', 'Review Asked',
  'Notes', 'Source', 'Lead ID'];
const COL = {}; HEADERS.forEach((h, i) => COL[h] = i + 1);
const STATUSES = ['New', 'Quoted', 'Booked', 'Done', 'Lost'];
const SHEET_NAME = 'Leads';

/* ------------------------------------------------------------------ */
/* Website endpoint                                                    */
/* ------------------------------------------------------------------ */

function doPost(e) {
  let d;
  try {
    d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad data' });
  }
  if (d.website) return json_({ ok: true });                 // spam-trap field filled in: a bot
  if (!d.phone && !d.email) return json_({ ok: false, error: 'No contact info' });

  const row = buildRow_(d);
  let isNew;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    isNew = saveRow_(row, clean_(d.leadId));
  } catch (err) {
    console.error(err);
    // ok:false makes the lights site fall back to opening Messages, so the lead is never lost.
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }

  if (isNew) {
    try { alertOwner_(row); } catch (err) { console.error('Alert email failed: ' + err); }
  }
  return json_({ ok: true });
}

// Opening the /exec URL in a browser confirms the endpoint is live.
function doGet() {
  return json_({ ok: true, message: 'Lead tracker is live.' });
}

/** Turns either website's quote into one row. */
function buildRow_(d) {
  const lights = /light/i.test(d.business || '') || /trlights/i.test(d.source || '') ||
                 d.where != null || d.colors != null;
  let details, quote, notes = [];

  if (lights) {
    const extras = [];
    if (+d.bushes) extras.push(d.bushes + ' bush' + (+d.bushes > 1 ? 'es' : ''));
    if (+d.trees) extras.push(d.trees + ' tree' + (+d.trees > 1 ? 's' : ''));
    details = [
      'Lights on: ' + (d.where || 'Not sure'),
      'Colors: ' + (d.colors || 'Not sure'),
      extras.length ? 'Extras: ' + extras.join(', ') + (d.extrasEstimate ? ' (from $' + d.extrasEstimate + ')' : '') : ''
    ].filter(Boolean).join(' · ');
    quote = '';                                   // roofline is priced after you measure
    if (+d.discount) notes.push('$' + d.discount + ' off promised');
  } else {
    details = [d.vehicle, d.car, d.package, d.addons, d.when].filter(Boolean).join(' · ');
    quote = Number(d.price) || Number(d.quote) || '';
    if (d.firstTime) notes.push('First-time customer');
    if (d.code) notes.push('Code ' + d.code);
    if (d.notes) notes.push('Customer note: ' + d.notes);
  }

  return [
    new Date(),
    lights ? CONFIG.lightsName : CONFIG.detailingName,
    clean_(d.name), formatPhone_(d.phone), clean_(d.email),
    clean_(d.address || d.town),
    clean_(details), quote, 'New', '',
    d.textsOk ? 'Yes' : 'No', '', '',
    clean_(notes.join(' · ')),
    clean_(d.campaign || d.source || ''),
    clean_(d.leadId || '')
  ];
}

/**
 * Adds the row, or updates it if the same visitor already sent this lead
 * (for example they went back and changed their package). Returns true if new.
 */
function saveRow_(row, leadId) {
  const sheet = leadsSheet_();
  if (leadId) {
    const last = sheet.getLastRow();
    if (last > 1) {
      const ids = sheet.getRange(2, COL['Lead ID'], last - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0 && i >= ids.length - 500; i--) {
        if (String(ids[i][0]) === leadId) {
          const r = i + 2;
          // Refresh what the customer typed; keep anything you've edited (status, dates, notes).
          ['Name', 'Phone', 'Email', 'Town / Address', 'Details', 'Quote $', 'Texts OK'].forEach(h => {
            const v = row[COL[h] - 1];
            if (v !== '' && v != null) sheet.getRange(r, COL[h]).setValue(v);
          });
          return false;
        }
      }
    }
  }
  sheet.appendRow(row);
  return true;
}

/* ------------------------------------------------------------------ */
/* Instant new-lead email                                              */
/* ------------------------------------------------------------------ */

function alertOwner_(row) {
  const biz = row[COL['Business'] - 1], name = row[COL['Name'] - 1], phone = row[COL['Phone'] - 1],
        email = row[COL['Email'] - 1], place = row[COL['Town / Address'] - 1],
        details = row[COL['Details'] - 1], quote = row[COL['Quote $'] - 1],
        notes = row[COL['Notes'] - 1], source = row[COL['Source'] - 1];
  const first = firstName_(name);
  const msg = biz === CONFIG.lightsName
    ? `Hi ${first}, it's ${CONFIG.ownerName} from TR Lights. Got your Christmas lights request! I'll measure from your address and text you your exact price shortly.`
    : `Hi ${first}, it's ${CONFIG.ownerName} from Summer-Salt. Got your quote request${quote ? ` ($${quote})` : ''}! Does that day and time still work for you?`;
  const html = `
    <h2 style="margin:0 0 8px">New ${esc_(biz)} lead</h2>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5">
      <b>${esc_(name) || '(no name)'}</b><br>
      ${place ? esc_(place) + '<br>' : ''}${esc_(details)}<br>
      ${quote ? `Quote: <b>$${quote}</b><br>` : ''}
      ${notes ? esc_(notes) + '<br>' : ''}
      ${esc_(phone)} ${email ? '· ' + esc_(email) : ''}<br>
      <span style="color:#888">Came from: ${esc_(source) || 'unknown'}</span>
    </p>
    ${phone ? button_(phone, msg, 'Text them now') : ''}
    <p style="color:#666;font-size:13px">Suggested text: ${esc_(msg)}</p>`;
  MailApp.sendEmail({
    to: ownerEmail_(),
    subject: `🔔 New ${biz} lead: ${name || phone}${place ? ' · ' + place : ''}`,
    htmlBody: html
  });
}

/* ------------------------------------------------------------------ */
/* Morning to-do email                                                 */
/* ------------------------------------------------------------------ */

function dailyDigest() {
  const sheet = leadsSheet_();
  const values = sheet.getDataRange().getValues();
  const today = dayStart_(new Date());
  const month = today.getMonth(), date = today.getDate();
  const sections = { follow: [], review: [], rebook: [], season: [] };
  const writes = [];

  // Latest detailing activity per phone, so nobody who already rebooked gets nagged.
  const latestByPhone = {};
  for (let i = 1; i < values.length; i++) {
    const r = rowObj_(values[i]);
    if (r.business !== CONFIG.detailingName || !r.phone) continue;
    const t = Math.max(time_(r.received), time_(r.jobDate));
    latestByPhone[r.phone] = Math.max(latestByPhone[r.phone] || 0, t);
  }

  for (let i = 1; i < values.length; i++) {
    const r = rowObj_(values[i]);
    const rowNum = i + 1;
    if (!r.phone && !r.email) continue;
    const isLights = r.business === CONFIG.lightsName;
    const first = firstName_(r.name);
    const biz = isLights ? CONFIG.lightsName : CONFIG.detailingName;

    // 1. One follow-up on new leads (after 1 day) and unbooked quotes (after N days).
    if (!r.lastFollowUp && (
        (r.status === 'New' && days_(r.received, today) >= 1) ||
        (r.status === 'Quoted' && days_(r.received, today) >= CONFIG.quoteFollowUpDays))) {
      const msg = isLights
        ? `Hi ${first}, it's ${CONFIG.ownerName} from TR Lights following up on your Christmas lights quote. Install dates are filling up. Want me to hold one for you?`
        : `Hi ${first}, it's ${CONFIG.ownerName} from Summer-Salt checking in on your detail quote. Want me to lock in a time this week?`;
      sections.follow.push(item_(r, msg));
      writes.push([rowNum, COL['Last Follow-up'], today]);
    }

    // 2. Review request for jobs finished in the last 2 weeks.
    if (r.status === 'Done' && !r.reviewAsked && r.jobDate &&
        days_(r.jobDate, today) >= 0 && days_(r.jobDate, today) <= 14) {
      const link = isLights ? CONFIG.lightsReviewLink : CONFIG.detailingReviewLink;
      const msg = `Thanks again for choosing ${biz}, ${first}! If you have 30 seconds, a quick Google review helps my small business a ton: ${link}`;
      sections.review.push(item_(r, msg));
      writes.push([rowNum, COL['Review Asked'], today]);
    }

    // 3. Detailing rebook, once per job, only if this was their latest visit.
    if (!isLights && r.status === 'Done' && r.jobDate && r.phone &&
        days_(r.jobDate, today) >= CONFIG.detailingRebookWeeks * 7 &&
        time_(r.jobDate) >= latestByPhone[r.phone] &&
        time_(r.lastFollowUp) < time_(r.jobDate)) {
      const msg = `Hi ${first}, it's ${CONFIG.ownerName} from Summer-Salt. It's been about ${CONFIG.detailingRebookWeeks} weeks since your last detail. Want me to swing by again?`;
      sections.rebook.push(item_(r, msg, true));
      writes.push([rowNum, COL['Last Follow-up'], today]);
    }

    // 4. Lights season: Aug 1 early-bird for past customers, Jan 2 takedown notice.
    if (isLights && r.jobDate && (r.status === 'Done' || r.status === 'Booked')) {
      const jobYear = new Date(r.jobDate).getFullYear();
      if (month === 7 && date === 1 && jobYear < today.getFullYear()) {
        sections.season.push(item_(r,
          `Hi ${first}, it's ${CONFIG.ownerName} from TR Lights! Your lights are already cut for your house, so returning customers get 15% off this year. Want me to save your install date?`, true));
      }
      if (month === 0 && date === 2 && jobYear === today.getFullYear() - 1) {
        sections.season.push(item_(r,
          `Hi ${first}, TR Lights here. Hope you enjoyed the lights! I'll be taking them down this month and will text you the day before. Want to lock in next year at 15% off?`));
      }
    }
  }

  writes.forEach(([row, col, val]) => sheet.getRange(row, col).setValue(val));

  const weatherNote = weatherNote_();
  const blocks = [
    ['📨 Follow up on quotes', sections.follow],
    ['⭐ Ask for a Google review', sections.review],
    ['🚗 Due for a detail', sections.rebook],
    ['🎄 Lights season', sections.season]
  ].filter(([, items]) => items.length);

  if (!blocks.length && !weatherNote) return; // nothing to do today, no email

  const html = [
    weatherNote ? `<p style="background:#fff6d6;padding:10px;border-radius:8px">${weatherNote}</p>` : '',
    ...blocks.map(([title, items]) =>
      `<h3 style="margin:20px 0 6px">${title} (${items.length})</h3>${items.join('')}`)
  ].join('');
  const count = blocks.reduce((n, [, items]) => n + items.length, 0);
  MailApp.sendEmail({
    to: ownerEmail_(),
    subject: count ? `☀️ Today: ${count} text${count === 1 ? '' : 's'} to send` : '☀️ Good day to post a deal',
    htmlBody: html + `<p style="color:#888;font-size:12px">Keep the Status column in your Leads sheet current so this list stays accurate.</p>`
  });
}

function weatherNote_() {
  try {
    const { lat, lon } = CONFIG.weather;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum,snowfall_sum&past_days=1&forecast_days=1` +
      `&timezone=America%2FNew_York&precipitation_unit=inch`;
    const d = JSON.parse(UrlFetchApp.fetch(url).getContentText()).daily;
    const snow = d.snowfall_sum[0] || 0, rain = d.precipitation_sum[0] || 0;
    if (snow > 0) return '❄️ It snowed yesterday and the roads are salted. Good day to post a "get the salt off" special on Instagram, Facebook and Nextdoor.';
    if (rain >= 0.25) return '🌧️ Heavy rain yesterday, so cars are dirty. Good day to post a before/after and a "book this week" offer.';
  } catch (err) { console.error(err); }
  return '';
}

/* ------------------------------------------------------------------ */
/* Setup & testing                                                     */
/* ------------------------------------------------------------------ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('America/New_York');
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  const rows = Math.max(1, sheet.getMaxRows() - 1);
  sheet.getRange(2, COL['Status'], rows).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  sheet.getRange(2, COL['Business'], rows).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([CONFIG.detailingName, CONFIG.lightsName], true).build());
  sheet.getRange(2, COL['Texts OK'], rows).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  ['Received', 'Job Date', 'Last Follow-up', 'Review Asked'].forEach(h =>
    sheet.getRange(2, COL[h], rows).setNumberFormat('m/d/yyyy'));
  sheet.getRange(2, COL['Phone'], rows).setNumberFormat('@');
  sheet.hideColumns(COL['Lead ID']);

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyDigest')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(CONFIG.digestHour).everyDays(1)
    .inTimezone('America/New_York').create();

  safeAlert_('Setup done. Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).');
}

/** Run this to see one fake lead from each website land in the sheet. */
function testLeads() {
  doPost({ postData: { contents: JSON.stringify({
    business: 'detailing', leadId: 'test-detail', name: 'Test Detail', phone: '7325551234',
    address: '12 Main St, Toms River, NJ', vehicle: 'SUV', car: '2019 Honda CR-V',
    package: 'Premium Detail', addons: 'Odor removal', when: 'Sat, Oct 11 · 10:00 AM',
    price: 330, code: 'FB20-3', textsOk: true, campaign: 'Facebook ad 3'
  }) } });
  doPost({ postData: { contents: JSON.stringify({
    business: 'lights', leadId: 'test-lights', name: 'Test Lights', phone: '7325554321',
    address: '45 Ocean Ave, Brick, NJ', where: 'Roofline, Peaks', colors: 'Warm white',
    bushes: 2, trees: 1, extrasEstimate: 225, discount: 150, textsOk: false,
    source: 'trlightsnj.com', campaign: 'Google search'
  }) } });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function leadsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { setup(); sh = ss.getSheetByName(SHEET_NAME); }
  return sh;
}

function rowObj_(v) {
  return {
    received: v[COL['Received'] - 1], business: v[COL['Business'] - 1], name: v[COL['Name'] - 1],
    phone: formatPhone_(v[COL['Phone'] - 1]), email: v[COL['Email'] - 1], place: v[COL['Town / Address'] - 1],
    details: v[COL['Details'] - 1], status: v[COL['Status'] - 1], jobDate: v[COL['Job Date'] - 1],
    textsOk: v[COL['Texts OK'] - 1] === 'Yes', lastFollowUp: v[COL['Last Follow-up'] - 1],
    reviewAsked: v[COL['Review Asked'] - 1]
  };
}

function item_(r, msg, marketing) {
  const consent = marketing && !r.textsOk
    ? '<span style="color:#b26a00;font-size:12px"> · didn\'t opt in to texts, so email or call instead</span>' : '';
  return `<div style="border:1px solid #e3e3e3;border-radius:10px;padding:10px 12px;margin:6px 0">
    <b>${esc_(r.name) || '(no name)'}</b> · ${esc_(r.phone || r.email)}${r.place ? ' · ' + esc_(r.place) : ''}${consent}<br>
    <span style="color:#555;font-size:13px">${esc_(msg)}</span><br>
    ${r.phone && !(marketing && !r.textsOk) ? button_(r.phone, msg, 'Text') : ''}
    ${r.email ? `<a href="mailto:${esc_(r.email)}?body=${encodeURIComponent(msg)}" style="margin-left:6px">Email</a>` : ''}
  </div>`;
}

function button_(phone, msg, label) {
  const digits = String(phone).replace(/\D/g, '');
  return `<a href="sms:+1${digits.slice(-10)}?&body=${encodeURIComponent(msg)}"
    style="display:inline-block;margin-top:6px;padding:8px 14px;background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">${label}</a>`;
}

function formatPhone_(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : clean_(p);
}

function clean_(s) {
  s = String(s == null ? '' : s).trim().slice(0, 1000);
  return /^[=+\-@]/.test(s) ? "'" + s : s; // stops spreadsheet formula injection
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function firstName_(name) { return String(name || 'there').trim().split(/\s+/)[0] || 'there'; }
function dayStart_(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function time_(d) { return d ? new Date(d).getTime() || 0 : 0; }
function days_(from, to) { return from ? Math.floor((dayStart_(to) - dayStart_(from)) / 86400000) : -1; }
function ownerEmail_() { return Session.getEffectiveUser().getEmail(); }
function safeAlert_(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); } }
