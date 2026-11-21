// STEP 5: talk to the WhatsApp provider (in this project: the fake-whatsapp container).
import { config } from '../config';

export type WhatsAppMessage = {
  to: string;
  text: string;
  link: string;
  // Same key on every retry. The provider delivers a key only once,
  // so a retry after a timeout can never send a second message.
  idempotencyKey: string;
};

export async function sendWhatsApp(message: WhatsAppMessage): Promise<{ id: string; duplicate: boolean }> {
  const res = await fetch(`${config.whatsappUrl}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(config.whatsappTimeoutMs), // never wait forever
  });
  if (!res.ok) throw new Error(`WhatsApp provider returned ${res.status}`);
  return (await res.json()) as { id: string; duplicate: boolean };
}
