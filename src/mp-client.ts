import { config, PLANS, PlanId } from './config.js';

export interface MpPayment {
  id: number;
  status: string;
  external_reference: string | null;
  transaction_amount: number;
  description?: string | null;
  date_approved?: string | null;
}

async function mpFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`https://api.mercadopago.com${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.mpAccessToken}`,
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'O Mercado Pago demorou demais pra responder. Tenta de novo.'
      : (err instanceof Error ? err.message : String(err));
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

export async function createPixPayment(
  userId: number,
  userEmail: string,
  username: string,
  planId: PlanId,
): Promise<{ id: number; qrBase64: string; qrCode: string }> {
  const plan = PLANS[planId];
  const body = {
    transaction_amount: plan.price,
    description: `CalcUltra Deluxe Edition - ${plan.title} (${plan.tag})`,
    payment_method_id: 'pix',
    external_reference: String(userId),
    notification_url: `${config.appUrl}/webhooks/mercadopago`,
    payer: { email: userEmail },
    point_of_interaction: {
      type: 'PIX',
    },
  };

  const res = await mpFetch('/v1/payments', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mercado Pago erro ao criar Pix (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    id: number;
    point_of_interaction?: { transaction_data?: { qr_code_base64?: string; qr_code?: string } };
  };
  return {
    id: data.id,
    qrBase64: data.point_of_interaction?.transaction_data?.qr_code_base64 || '',
    qrCode: data.point_of_interaction?.transaction_data?.qr_code || '',
  };
}

export async function getPayment(paymentId: number): Promise<MpPayment> {
  const res = await mpFetch(`/v1/payments/${paymentId}`);
  if (!res.ok) throw new Error(`Falha ao buscar pagamento ${paymentId}: ${res.status}`);
  return (await res.json()) as MpPayment;
}
