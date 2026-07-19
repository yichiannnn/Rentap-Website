/* RENTAP XVII — script.js */

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
  player: false,
  volunteer: true,
  spectator: false,
  vendor: false
};

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
    title: 'Vendor Registration Opens Soon',
    msg: 'Food vendor sign-ups are not open just yet. Registration will open soon — check back to secure a stall at the RENTAP bazaar.'
  }
};

function openModal(type) {
  const panes = ['form-player', 'form-volunteer', 'form-spectator', 'form-vendor', 'form-comingsoon', 'form-success'];
  panes.forEach(id => { document.getElementById(id).hidden = true; });

  if (REG_OPEN[type]) {
    document.getElementById('form-' + type).hidden = false;
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
    data.sport = fieldVal('p-sport');
    data.team = fieldVal('p-team');
  } else if (type === 'volunteer') {
    data.name = fieldVal('v-name');
    data.email = fieldVal('v-email');
    data.phone = fieldVal('v-phone');
    data.university = fieldVal('v-uni');
    data.role = fieldVal('v-role');
  } else if (type === 'spectator') {
    data.name = fieldVal('s-name');
    data.email = fieldVal('s-email');
    data.membership = fieldVal('s-member');
  } else if (type === 'vendor') {
    data.stall = fieldVal('fv-stall');
    data.name = fieldVal('fv-name');
    data.email = fieldVal('fv-email');
    data.phone = fieldVal('fv-phone');
    data.food = fieldVal('fv-food');
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
