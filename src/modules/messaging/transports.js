import { sanitizeText } from '../../shared/utils/text.js';

export async function loadOutboundTransports() {
  const customModule = process.env.OUTBOUND_TRANSPORT_MODULE;
  if (customModule) {
    try {
      const mod = await import(customModule);
      if (mod?.sendEmail || mod?.sendSms) {
        return {
          sendEmail: mod.sendEmail || null,
          sendSms: mod.sendSms || null,
        };
      }
    } catch (error) {
      console.warn('[outbound] Failed to load custom module', customModule, error);
    }
  }

  const emailWebhook = process.env.OUTBOUND_EMAIL_WEBHOOK;
  const smsWebhook = process.env.OUTBOUND_SMS_WEBHOOK;
  const headers = parseHeaders(process.env.OUTBOUND_WEBHOOK_HEADERS);

  const transport = {
    sendEmail: emailWebhook ? buildWebhookSender(emailWebhook, headers) : logStub('email'),
    sendSms: smsWebhook ? buildWebhookSender(smsWebhook, headers) : logStub('sms'),
  };
  return transport;
}

function buildWebhookSender(url, headers = {}) {
  return async (payload) => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      return true;
    } catch (error) {
      console.warn('[outbound] webhook delivery failed', error);
      return false;
    }
  };
}

function logStub(channel) {
  return async (payload) => {
    const to = sanitizeText(payload.to || '', 120);
    console.info(`[outbound ${channel} stub] to=${to} subject=${payload.subject || ''} body=${(payload.body || '').slice(0, 160)}`);
    return true;
  };
}

function parseHeaders(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (error) {
    // fall through
  }
  return {};
}
