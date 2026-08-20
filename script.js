/* RENTAP XVII — script.js */

// ── ANNOUNCEMENT BANNER (shared, phase 2) ─────
// Fetches the newest pinned/published/non-expired announcement and injects a
// slim banner under the navbar. Fails silently. Dismiss is per-page-view only
// (no persistence). Exposed as window.mountAnnouncementBanner so pages that do
// not load script.js can call the same logic inline.
(function () {
  function escHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  const ICON = {
    urgent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    important: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  async function mount(opts) {
    opts = opts || {};
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    let ann;
    try {
      const res = await fetch('/api/content?type=announcements', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      const list = (data && data.announcements) || [];
      ann = list.find(a => a.pinned); // newest-first from the API
    } catch (_) { return; }
    if (!ann) return;

    const level = ['info', 'important', 'urgent'].includes(ann.level) ? ann.level : 'info';
    const body = (ann.body || '').toString();
    const short = body.length <= 140;
    const bodyHtml = short
      ? `<span class="ann-banner-body"> — ${escHtml(body)}</span>`
      : ` <a class="ann-banner-more" href="announcements.html">Read more</a>`;

    const el = document.createElement('div');
    el.className = 'ann-banner ann-banner--' + level + (opts.inline ? ' ann-banner--inline' : '');
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="ann-banner-inner">' +
      '<span class="ann-banner-icon">' + ICON[level] + '</span>' +
      '<span class="ann-banner-text"><span class="ann-banner-title">' + escHtml(ann.title) + '</span>' + bodyHtml + '</span>' +
      '<button class="ann-banner-close" aria-label="Dismiss announcement">' + CLOSE + '</button>' +
      '</div>';

    // insert directly after the navbar
    navbar.insertAdjacentElement('afterend', el);
    el.querySelector('.ann-banner-close').addEventListener('click', () => el.remove());
  }

  window.mountAnnouncementBanner = mount;

  // ── Homepage "Latest Updates" section (index.html only) ──
  function fmtDate(s) {
    const d = new Date(s);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
      ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  async function mountHomeAnnouncements() {
    const section = document.getElementById('homeAnn');
    const list = document.getElementById('homeAnnList');
    if (!section || !list) return;
    let items = [];
    try {
      const res = await fetch('/api/content?type=announcements', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      items = (data && data.announcements) || [];
    } catch (_) { return; }
    if (!items.length) return; // stay hidden when there is nothing

    // Pinned first, then newest — show up to 3.
    items.sort((a, b) => (b.pinned === true) - (a.pinned === true));
    const top = items.slice(0, 3);
    list.innerHTML = top.map(a => {
      const lvl = ['info', 'important', 'urgent'].includes(a.level) ? a.level : 'info';
      let badge = '';
      if (lvl === 'urgent') badge = '<span class="home-ann-badge urgent">Urgent</span>';
      else if (lvl === 'important') badge = '<span class="home-ann-badge important">Important</span>';
      const body = (a.body || '').toString();
      const shortBody = body.length > 180 ? escHtml(body.slice(0, 177)) + '…' : escHtml(body);
      return '<div class="home-ann-card lvl-' + lvl + '">' +
        '<div class="home-ann-card-head">' +
        '<span class="home-ann-card-title">' + escHtml(a.title) + '</span>' + badge +
        '<span class="home-ann-date">' + escHtml(fmtDate(a.created_at)) + '</span>' +
        '</div><div class="home-ann-body">' + shortBody + '</div></div>';
    }).join('');
    section.hidden = false;
  }

  // auto-run on pages that load script.js (index.html, sport.html)
  function start() { mount(); mountHomeAnnouncements(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

// ── NAVBAR SCROLL ─────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ── MOBILE NAV TOGGLE ─────────────────────────
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  navToggle.classList.toggle('open', isOpen);
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

// Close nav when a link is clicked
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// ── COUNTDOWN ─────────────────────────────────
function updateCountdown() {
  const target = new Date('2026-09-26T08:00:00');
  const now    = new Date();
  const diff   = target - now;

  if (diff <= 0) {
    document.getElementById('cd-days').textContent  = '00';
    document.getElementById('cd-hours').textContent = '00';
    document.getElementById('cd-mins').textContent  = '00';
    document.getElementById('cd-secs').textContent  = '00';
    return;
  }

  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000)  / 60000);
  const secs  = Math.floor((diff % 60000)    / 1000);

  const pad = n => String(n).padStart(2, '0');
  document.getElementById('cd-days').textContent  = pad(days);
  document.getElementById('cd-hours').textContent = pad(hours);
  document.getElementById('cd-mins').textContent  = pad(mins);
  document.getElementById('cd-secs').textContent  = pad(secs);
}

updateCountdown();
setInterval(updateCountdown, 1000);

// ── SCHEDULE TABS ─────────────────────────────
function switchTab(day, btn) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));

  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.getElementById('panel-' + day).classList.remove('hidden');
}

// ── FAQ ACCORDION ─────────────────────────────
function toggleFaq(btn) {
  const answer   = btn.closest('.faq-item').querySelector('.faq-answer');
  const expanded = btn.getAttribute('aria-expanded') === 'true';

  // Close all others
  document.querySelectorAll('.faq-btn[aria-expanded="true"]').forEach(other => {
    if (other !== btn) {
      other.setAttribute('aria-expanded', 'false');
      other.closest('.faq-item').querySelector('.faq-answer').hidden = true;
    }
  });

  btn.setAttribute('aria-expanded', String(!expanded));
  answer.hidden = expanded;
}

// ── REGISTRATION MODAL ────────────────────────
const overlay  = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');

// ── Registration availability ────────────────
// Flip a value to true when that registration opens.
const REG_OPEN = {
  player: true,
  volunteer: true,
  spectator: false,
  vendor: false
};

// Members-only early access. Set a type to false when it opens to everyone.
const EARLY_ACCESS = {
  player: true,
  volunteer: false
};

// Set once a membership code has been verified in this session.
let verifiedMemberCode = null;
// Which form to open after the gate is passed.
let pendingGateType = null;

const COMING_SOON = {
  player: {
    title: 'Player Registration Opens Soon',
    msg: 'Sport sign-ups are not open just yet. Registration will open soon — check back closer to the event to pick your sport and build your team.'
  },
  spectator: {
    title: 'Spectator Registration Opens Soon',
    msg: 'Spectator entry is not open yet. Registration will open soon — check back nearer the event to reserve your spot and cheer the teams on.'
  },
  vendor: {
    title: 'Vendor Registration Full',
    msg: 'All bazaar stalls have been filled — vendor registration is now closed. Thank you for your interest! If you have any questions, please contact us.'
  }
};

function openModal(type) {
  const panes = ['form-player-gate', 'form-player', 'form-volunteer', 'form-spectator', 'form-vendor', 'form-comingsoon', 'form-success'];
  panes.forEach(id => { document.getElementById(id).hidden = true; });

  if (REG_OPEN[type]) {
    // Members-only early access: require a verified MGSS code first.
    if (EARLY_ACCESS[type] && !verifiedMemberCode) {
      pendingGateType = type;
      document.getElementById('pg-error').hidden = true;
      const desc = document.getElementById('pg-desc');
      if (desc) {
        const label = type === 'volunteer' ? 'Volunteer sign-up' : 'Player registration';
        desc.textContent = label + ' is open to MGSS & MAK members first. Enter your membership code to continue.';
      }
      document.getElementById('form-player-gate').hidden = false;
    } else {
      document.getElementById('form-' + type).hidden = false;
    }
  } else {
    const info = COMING_SOON[type] || {
      title: 'Registration Opening Soon',
      msg: 'This registration is not open yet. Please check back soon.'
    };
    document.getElementById('cs-title').textContent = info.title;
    document.getElementById('cs-msg').textContent = info.msg;
    document.getElementById('form-comingsoon').hidden = false;
  }

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  // Focus the first input
  setTimeout(() => {
    const first = modalBox.querySelector('input, select, button');
    if (first) first.focus();
  }, 50);
}

// ── Members' early-access gate ───────────────
async function verifyMemberCode(e) {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const input = document.getElementById('pg-code');
  const errEl = document.getElementById('pg-error');
  const btn = document.getElementById('pg-submit');
  const code = input.value.trim();

  errEl.hidden = true;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    const res = await fetch('/api/verify-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (data && data.valid) {
      verifiedMemberCode = data.code;
      const openType = pendingGateType || 'player';
      document.getElementById('form-player-gate').hidden = true;
      document.getElementById('form-' + openType).hidden = false;
      setTimeout(() => {
        const first = document.querySelector('#form-' + openType + ' input, #form-' + openType + ' select');
        if (first) first.focus();
      }, 50);
    } else {
      errEl.textContent = (data && data.error) || 'That membership code was not found.';
      errEl.hidden = false;
      input.focus();
      input.select();
    }
  } catch (err) {
    errEl.textContent = 'Could not verify right now. Please check your connection and try again.';
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ── Player form: sport-dependent fields ──────
const TEAM_SPORTS = ['Football', 'Basketball', 'Volleyball', 'Touch Rugby', 'Frisbee', 'Tug of War'];

const SPORT_CATEGORIES = {
  'Badminton':     ["Women's Singles", "Men's Singles", "Women's Doubles", "Men's Doubles", "Mixed Doubles"],
  'Table Tennis':  ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"],
  'Track':         ['100m', '200m', '400m', '4×100m Relay']
};

function updatePlayerFields() {
  const sport = document.getElementById('p-sport').value;
  const isTeam = TEAM_SPORTS.indexOf(sport) !== -1;
  const cats = SPORT_CATEGORIES[sport];

  // Team sports → team name (required) + members
  const teamField = document.getElementById('p-team-field');
  const teamInput = document.getElementById('p-team');
  const membersField = document.getElementById('p-members-field');
  teamField.hidden = !isTeam;
  teamInput.required = isTeam;
  membersField.hidden = !isTeam;
  if (!isTeam) { teamInput.value = ''; document.getElementById('p-members').value = ''; }

  // Individual sports → category select
  const catField = document.getElementById('p-category-field');
  const catSelect = document.getElementById('p-category');
  if (cats) {
    catSelect.innerHTML = '<option value="">Select a category…</option>' +
      cats.map(c => '<option>' + c + '</option>').join('');
    catField.hidden = false;
    catSelect.required = true;
  } else {
    catSelect.innerHTML = '<option value="">Select a category…</option>';
    catSelect.value = '';
    catField.hidden = true;
    catSelect.required = false;
  }

  updatePartnerField();
}

function updatePartnerField() {
  const cat = document.getElementById('p-category').value;
  const field = document.getElementById('p-partner-field');
  const input = document.getElementById('p-partner');
  const label = document.getElementById('p-partner-label');
  const isRelay = /Relay/i.test(cat);
  const needs = /Doubles/i.test(cat) || isRelay;

  field.hidden = !needs;
  input.required = needs;
  if (!needs) { input.value = ''; return; }

  label.textContent = isRelay ? 'Relay Teammates' : "Partner's Name";
  input.placeholder = isRelay ? 'Names of your 3 teammates' : "Your partner's full name";
}

function toggleMemberNo() {
  const val = document.getElementById('s-member').value;
  const field = document.getElementById('s-memberno-field');
  const input = document.getElementById('s-memberno');
  const isMember = val.indexOf('Yes') === 0;
  field.hidden = !isMember;
  input.required = isMember;
  if (!isMember) input.value = '';
}

function toggleCoordSport() {
  const role = document.getElementById('v-role').value;
  const field = document.getElementById('v-sport-field');
  const select = document.getElementById('v-sport');
  const isCoord = role === 'Sports Coordinator';
  field.hidden = !isCoord;
  select.required = isCoord;
  if (!isCoord) select.value = '';
}

function toggleRoleInfo(btn) {
  const panel = document.getElementById('role-info');
  const isOpen = !panel.hidden;
  panel.hidden = isOpen;
  btn.setAttribute('aria-expanded', String(!isOpen));
}

function closeModal() {
  overlay.hidden = true;
  document.body.style.overflow = '';
  // Reset the role-info panel each time the modal closes
  const panel = document.getElementById('role-info');
  const btn = document.getElementById('roleInfoBtn');
  if (panel) panel.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// Close on overlay click
overlay.addEventListener('click', e => {
  if (e.target === overlay) closeModal();
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !overlay.hidden) closeModal();
});

function fieldVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function showRegSuccess() {
  document.getElementById('form-player').hidden    = true;
  document.getElementById('form-volunteer').hidden = true;
  document.getElementById('form-spectator').hidden = true;
  document.getElementById('form-vendor').hidden    = true;
  document.getElementById('form-success').hidden   = false;
  document.getElementById('form-success').querySelector('button').focus();
}

async function submitForm(e) {
  e.preventDefault();
  const form = e.target;

  // Native validation (forms use novalidate, so trigger it explicitly)
  if (!form.checkValidity()) { form.reportValidity(); return; }

  // Which registration pane is active?
  let type = null;
  if (!document.getElementById('form-player').hidden)         type = 'player';
  else if (!document.getElementById('form-volunteer').hidden) type = 'volunteer';
  else if (!document.getElementById('form-spectator').hidden) type = 'spectator';
  else if (!document.getElementById('form-vendor').hidden)    type = 'vendor';
  if (!type) return;

  const data = { type };
  if (type === 'player') {
    data.name = fieldVal('p-name');
    data.email = fieldVal('p-email');
    data.phone = fieldVal('p-phone');
    data.sport = fieldVal('p-sport');
    if (verifiedMemberCode) data.memberNo = verifiedMemberCode;
    if (TEAM_SPORTS.indexOf(data.sport) !== -1) {
      data.team = fieldVal('p-team');
      data.members = fieldVal('p-members');
    } else {
      data.category = fieldVal('p-category');
      // Partner / relay teammates are stored alongside team members
      data.members = fieldVal('p-partner');
    }
  } else if (type === 'volunteer') {
    data.name = fieldVal('v-name');
    data.email = fieldVal('v-email');
    data.phone = fieldVal('v-phone');
    data.university = fieldVal('v-uni');
    data.role = fieldVal('v-role');
    if (data.role === 'Sports Coordinator') data.sport = fieldVal('v-sport');
    if (verifiedMemberCode) data.memberNo = verifiedMemberCode;
  } else if (type === 'spectator') {
    data.name = fieldVal('s-name');
    data.email = fieldVal('s-email');
    data.phone = fieldVal('s-phone');
    data.membership = fieldVal('s-member');
    if (data.membership.indexOf('Yes') === 0) data.memberNo = fieldVal('s-memberno');
  } else if (type === 'vendor') {
    data.name = fieldVal('fv-name');
    data.email = fieldVal('fv-email');
    data.phone = fieldVal('fv-phone');
    data.people = fieldVal('fv-people');
    data.food = fieldVal('fv-desc');
  }

  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Request failed');
    showRegSuccess();
  } catch (err) {
    alert('Sorry, something went wrong submitting your registration. Please try again, or email malaysiangermanstudentssociety@gmail.com.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── SMOOTH SCROLL OFFSET for fixed navbar ─────
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const id = link.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});
