// Mobile menu
document.getElementById('menuBtn')?.addEventListener('click', () => {
  document.getElementById('mobileMenu')?.classList.toggle('hidden');
});

// Footer year
const y = document.getElementById('year');
if (y) y.textContent = new Date().getFullYear();

// Countdown
(function initCountdown(){
  const el = document.getElementById('countdown');
  if(!el) return;
  const start = el.getAttribute('data-start');
  const startTime = start ? new Date(start) : null;
  if(!startTime) return;
  function tick(){
    const now = new Date();
    const diff = startTime - now;
    if(diff <= 0){
      el.querySelector('[data-days]').textContent = '0';
      el.querySelector('[data-hours]').textContent = '0';
      el.querySelector('[data-minutes]').textContent = '0';
      el.querySelector('[data-seconds]').textContent = '0';
      return;
    }
    const sec = Math.floor(diff / 1000);
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    el.querySelector('[data-days]').textContent = days;
    el.querySelector('[data-hours]').textContent = hours;
    el.querySelector('[data-minutes]').textContent = minutes;
    el.querySelector('[data-seconds]').textContent = seconds;
    requestAnimationFrame(tick);
  }
  tick();
})();
