(() => {
  const display = document.getElementById('calcDisplay');
  const result = document.getElementById('calcResult');
  const errorBox = document.getElementById('calcError');
  const errorText = document.getElementById('calcErrorText');
  const creditNote = document.getElementById('calcCreditNote');
  const creditNoteText = document.getElementById('calcCreditNoteText');
  const badge = document.getElementById('planBadge');
  const keypad = document.querySelectorAll('.calc-key');
  const padMain = document.getElementById('padMain');
  const padFunc = document.getElementById('padFunc');
  const aiTab = document.getElementById('tabResolvedor');

  const pretty = { '*': '×', '/': '÷', '-': '−' };
  const symbols = { '×': '*', '÷': '/', '−': '-', ',': '.' };
  let buffer = '';
  let justEvaluated = false;

  function prettyOf(raw) {
    return raw
      .split('')
      .map((c) => pretty[c] || c)
      .join('')
      .replace(/\bsqrt\b/g, '√')
      .replace(/\bpi\b/g, 'π');
  }

  function show(el, visible) {
    if (el) el.hidden = !visible;
  }

  function showLoginError() {
    errorText.textContent = 'Você precisa entrar para ver a resposta.';
    const link = document.createElement('a');
    link.href = '/#acesso';
    link.className = 'ml-1 font-semibold underline underline-offset-2';
    link.textContent = 'Entrar';
    errorText.appendChild(link);
    show(creditNote, false);
    show(errorBox, true);
  }

  function showError(message) {
    errorText.textContent = message;
    show(creditNote, false);
    show(errorBox, true);
  }

  function render() {
    display.textContent = buffer ? prettyOf(buffer) : '\u00A0';
    result.textContent = '\u00A0';
  }

  function press(key) {
    if (key === '2nd') {
      if (padMain && padFunc) {
        padMain.hidden = !padMain.hidden;
        padFunc.hidden = !padFunc.hidden;
      }
      return;
    }
    if (key === 'AC') {
      buffer = '';
      show(errorBox, false);
      show(creditNote, false);
      render();
      return;
    }
    if (key === 'back') {
      buffer = buffer.slice(0, -1);
      show(errorBox, false);
      render();
      return;
    }
    if (key === '=') {
      evaluate();
      return;
    }

    const mapped = symbols[key] || key;
    if (justEvaluated && !['+', '-', '*', '/', '^', '(', '.'].includes(mapped)) {
      buffer = '';
    }
    justEvaluated = false;
    buffer += mapped;
    show(errorBox, false);
    render();
  }

  async function evaluate() {
    if (!buffer) return;
    const expression = buffer;
    display.textContent = prettyOf(expression) + ' =';
    result.textContent = 'calculando...';
    show(errorBox, false);
    show(creditNote, false);

    try {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const res = await fetch('/api/calcular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ expression }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.error) {
        result.textContent = '¯\\_(ツ)_/¯';
        if (res.status === 401) {
          showLoginError();
        } else if (data && data.error) {
          showError(data.error);
        } else {
          showError('Resposta inesperada do servidor. Recarrega a página e tenta de novo.');
        }
        return;
      }
      result.textContent = data.result;
      buffer = data.result.split(' ')[0].replace(/,/g, '.').replace(/[×÷]/g, '');
      justEvaluated = true;
      show(errorBox, false);
      if (data.usedCredit) {
        creditNoteText.textContent = 'Custo: 1 crédito (edição gratuita). Assine a Deluxe Edition e calcule de graça.';
        show(creditNote, true);
      }
      refreshStatus();
    } catch {
      result.textContent = '¯\\_(ツ)_/¯';
      showError('Erro de rede. A calculadora não conseguiu nem se conectar, imagina calcular.');
    }
  }

  function refreshStatus() {
    fetch('/api/status')
      .then((r) => r.json())
      .catch(() => null)
      .then((status) => {
        if (!status) return;
        if (badge) {
          badge.textContent = status.full
            ? status.days_left !== null && status.days_left <= 2
              ? (status.days_left <= 0 ? 'Plano acaba hoje — renova!' : `Plano acaba em ${status.days_left} dia(s)`)
              : 'Edição paga — acesso completo'
            : `Edição gratuita — ${status.credits} crédito(s)`;
          badge.classList.add(status.full ? 'paid' : 'free');
        }
        const creditValue = document.getElementById('creditValue');
        if (creditValue) creditValue.textContent = status.credits;
      });
  }

  keypad.forEach((btn) => {
    btn.addEventListener('click', () => press(btn.dataset.key));
  });

  window.addEventListener('keydown', (e) => {
    if (aiTab && !aiTab.hidden) return;
    const target = e.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;

    const map = {
      '+': '+', '-': '-', '*': '*', '/': '/', '.': '.', ',': '.', '(': '(', ')': ')',
      '^': '^', '%': '%', '!': '!',
      'Enter': '=', 'Backspace': 'back', 'Escape': 'AC', 'Delete': 'AC',
    };
    if (/^[0-9]$/.test(e.key)) return press(e.key);
    const key = map[e.key];
    if (key) {
      e.preventDefault();
      return press(key);
    }
  });

  render();

  if (badge || document.getElementById('creditValue')) {
    refreshStatus();
  }
})();
