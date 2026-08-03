import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const OK_BODY = {
  choices: [
    {
      message: {
        content:
          '{"resposta":"Sobraram 4.","passos_simples":[{"titulo":"Subtrair","texto":"10 - 6 = 4"}],"passos_avancados":[],"alternativas":[],"suposicoes":[]}',
      },
    },
  ],
};

async function mockFetch(sequence: Array<{ status: number; body: unknown }>) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const item = sequence[Math.min(i, sequence.length - 1)];
      i++;
      return new Response(JSON.stringify(item.body), {
        status: item.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

describe('ai-client — resiliência do resolvedor', () => {
  let solveWordProblem: (q: string) => Promise<{ resposta: string }>;

  beforeAll(async () => {
    const [{ config }, mod] = await Promise.all([
      import('../src/config.js'),
      import('../src/ai-client.js'),
    ]);
    config.openRouterKey = 'test-key';
    solveWordProblem = mod.solveWordProblem;
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    const { config } = await import('../src/config.js');
    config.openRouterKey = '';
  });

  it('resolve na primeira tentativa', async () => {
    await mockFetch([{ status: 200, body: OK_BODY }]);
    const result = await solveWordProblem('10-6?');
    expect(result.resposta).toBe('Sobraram 4.');
  });

  it('tenta de novo quando a IA volta vazia e depois resolve', async () => {
    await mockFetch([{ status: 200, body: { choices: [] } }, { status: 200, body: OK_BODY }]);
    const result = await solveWordProblem('10-6?');
    expect(result.resposta).toBe('Sobraram 4.');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('reporta erro do OpenRouter com mensagem clara', async () => {
    await mockFetch([{ status: 200, body: { error: { message: 'Model is overloaded' } } }]);
    await expect(solveWordProblem('x?')).rejects.toThrow('indisponível');
  });

  it('desiste depois das tentativas e avisa pra tentar de novo', async () => {
    await mockFetch([
      { status: 200, body: { choices: [] } },
      { status: 200, body: { choices: [] } },
      { status: 200, body: { choices: [] } },
    ]);
    await expect(solveWordProblem('x?')).rejects.toThrow('Tenta de novo');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('cai no modelo reserva quando o principal volta sem resposta', async () => {
    const { config } = await import('../src/config.js');
    config.openRouterFallbackModels = ['modelo-reserva'];
    await mockFetch([{ status: 200, body: { choices: [] } }, { status: 200, body: OK_BODY }]);
    const result = await solveWordProblem('10-6?');
    expect(result.resposta).toBe('Sobraram 4.');
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0][1].body as string).model).toBe(config.openRouterModel);
    expect(JSON.parse(calls[1][1].body as string).model).toBe('modelo-reserva');
    config.openRouterFallbackModels = [];
  });

  it('usa orçamento de tokens suficiente pra modelos de raciocínio', async () => {
    await mockFetch([
      {
        status: 200,
        body: {
          choices: [
            {
              message: {
                content: null,
                reasoning: 'x'.repeat(2000),
              },
              finish_reason: 'length',
            },
          ],
        },
      },
      { status: 200, body: OK_BODY },
    ]);
    const result = await solveWordProblem('10-6?');
    expect(result.resposta).toBe('Sobraram 4.');
    const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string);
    expect(first.max_tokens).toBeGreaterThanOrEqual(4000);
  });
});
