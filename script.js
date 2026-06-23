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

function openModal(type) {
  document.getElementById('form-player').hidden    = (type !== 'player');
  document.getElementById('form-volunteer').hidden = (type !== 'volunteer');
  document.getElementById('form-success').hidden   = true;

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  // Focus the first input
  setTimeout(() => {
    const first = modalBox.querySelector('input, select, button');
    if (first) first.focus();
  }, 50);
}

function closeModal() {
  overlay.hidden = true;
  document.body.style.overflow = '';
}

// Close on overlay click
overlay.addEventListener('click', e => {
  if (e.target === overlay) closeModal();
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !overlay.hidden) closeModal();
});

function submitForm(e) {
  e.preventDefault();
  document.getElementById('form-player').hidden    = true;
  document.getElementById('form-volunteer').hidden = true;
  document.getElementById('form-success').hidden   = false;
  document.getElementById('form-success').querySelector('button').focus();
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
