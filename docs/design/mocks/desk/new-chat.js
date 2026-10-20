// New chat, no launcher (mock). Every way in opens the new chat itself with its agent already chosen: the Talk header's New chat, the + in the
// sessions list, a + on a crew sigil, and Cmd Shift O. The empty chat offers the other agents until the first message. Nothing here sends.
// Runs after desk.js, which has drawn the crew, sigils and icons.
import { icon } from '../../prototype/shared.js';

const q = new URLSearchParams(location.search);
const body = document.body;

// A + on each crew sigil starts a new chat with that agent; the sigil itself still opens the agent's latest chat.
for (const mate of document.querySelectorAll('.crew .mate')) {
  const agent = mate.querySelector('.sg')?.dataset.a;
  const wrap = Object.assign(document.createElement('div'), { className: 'mate-wrap' });
  mate.replaceWith(wrap);
  wrap.append(mate);
  wrap.insertAdjacentHTML('beforeend', `<a class="mate-new" href="#" data-new="${agent}" aria-label="New chat with ${agent}">${icon('plus')}</a>`);
  if (q.get('hover') === agent) wrap.dataset.hover = '';
}

const startNew = (agent) => {
  const next = new URLSearchParams({ step: 'landed', agent });
  if (q.has('theme')) next.set('theme', q.get('theme'));
  location.search = next.toString();
};
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-new]');
  if (!link) return;
  e.preventDefault();
  startNew(link.dataset.new);
});
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'o' && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startNew(body.dataset.agent); }
});

// The new chat opens ready to type, and lists it at the top of the agent's sessions.
if (body.dataset.step === 'landed') {
  for (const row of document.querySelectorAll('.cx-row:not(.nc-landed)')) row.removeAttribute('aria-current');
  const msg = document.getElementById('msg');
  msg.focus();
  msg.setSelectionRange(msg.value.length, msg.value.length);
}
