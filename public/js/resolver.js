(() => {
  const question = document.getElementById('aiQuestion');
  const btn = document.getElementById('btnResolve');
  const output = document.getElementById('aiOutput');
  const errorBox = document.getElementById('aiError');
  if (!question || !btn || !output || !errorBox) return;

  function show(el, visible) {
    el.hidden = !visible;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderSteps(steps, accent) {
    const list = el('ol', 'space-y-3');
    steps.forEach((step, i) => {
      const item = el('li', 'flex gap-3');
      const num = el('span', 'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ' + accent, String(i + 1));
      const box = el('div', 'min-w-0');
      box.appendChild(el('p', 'text-sm font-semibold', step.titulo));
      box.appendChild(el('p', 'text-sm text-neutral-500 leading-relaxed', step.texto));
      item.appendChild(num);
      item.appendChild(box);
      list.appendChild(item);
    });
    return list;
  }

  function render(data) {
    output.textContent = '';
    const answer = el('div', 'border-3 border-ink rounded-card bg-ink text-paper p-6 shadow-solid');
    answer.appendChild(el('p', 'eyebrow !text-paper/60', 'Resposta'));
    answer.appendChild(el('p', 'mt-2 font-heading text-2xl font-black tracking-tight text-gold', data.resposta));
    output.appendChild(answer);

    if (data.passos_simples && data.passos_simples.length) {
      const card = el('div', 'border-3 border-ink rounded-card bg-white p-6 card-hover shadow-solid-sm');
      card.appendChild(el('p', 'eyebrow', 'Passo a passo'));
      card.appendChild(renderSteps(data.passos_simples, 'bg-royal text-white border-3 border-ink'));
      output.appendChild(card);
    }

    if (data.passos_avancados && data.passos_avancados.length) {
      const details = el('details', 'border-3 border-ink rounded-card bg-ink text-paper p-6 shadow-solid');
      const summary = el('summary', 'cursor-pointer text-sm font-semibold flex items-center gap-2');
      summary.appendChild(el('span', 'eyebrow !text-paper/60', 'Abordagem avançada'));
      details.appendChild(summary);
      details.appendChild(renderSteps(data.passos_avancados, 'bg-gold text-ink border-3 border-ink'));
      output.appendChild(details);
    }

    if (data.alternativas && data.alternativas.length) {
      const details = el('details', 'border-3 border-ink rounded-card bg-white p-6 card-hover shadow-solid-sm');
      const summary = el('summary', 'cursor-pointer text-sm font-semibold flex items-center gap-2');
      summary.appendChild(el('span', 'eyebrow', 'Alternativas'));
      details.appendChild(summary);
      details.appendChild(renderSteps(data.alternativas, 'bg-paper text-ink border-3 border-ink'));
      output.appendChild(details);
    }

    if (data.suposicoes && data.suposicoes.length) {
      const card = el('div', 'border-3 border-ink rounded-card bg-gold p-6 shadow-solid-sm');
      card.appendChild(el('p', 'eyebrow !text-ink', 'Suposições'));
      const list = el('ul', 'mt-3 space-y-1.5 text-sm text-ink list-disc list-inside');
      data.suposicoes.forEach((s) => list.appendChild(el('li', '', s)));
      card.appendChild(list);
      output.appendChild(card);
    }
  }

  function showError(message, withLoginLink) {
    errorBox.textContent = '';
    if (withLoginLink) {
      errorBox.textContent = 'Você precisa entrar para usar o resolvedor. ';
      const link = el('a', 'font-semibold underline underline-offset-2', 'Entrar');
      link.href = '/#acesso';
      errorBox.appendChild(link);
    } else {
      errorBox.textContent = message;
    }
    show(errorBox, true);
  }

  async function resolve() {
    show(errorBox, false);
    output.textContent = '';
    const text = question.value.trim();
    if (!text) {
      showError('Escreve o problema da prova primeiro.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Resolvendo...';
    try {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const res = await fetch('/api/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ question: text }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.error) {
        if (res.status === 401) {
          showError('', true);
        } else if (data && data.error) {
          showError(data.error);
        } else {
          showError('Resposta inesperada do servidor. Recarrega a página e tenta de novo.');
        }
      } else {
        render(data);
      }
    } catch {
      showError('Erro de rede. A IA não conseguiu nem se conectar, imagina resolver prova.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Resolver com a IA';
    }
  }

  btn.addEventListener('click', resolve);
  question.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) resolve();
  });
})();
