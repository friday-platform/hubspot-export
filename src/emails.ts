import { getClient, hubspotFetch } from "./hubspot.ts";
import { stripHtml } from "./utils.ts";

const EMAIL_PROPERTIES = [
  "hs_email_subject",
  "hs_email_text",
  "hs_email_html",
  "hs_email_direction",
  "hs_timestamp",
  "hs_email_sender_email",
  "hs_email_to_email",
  "hs_email_from_email",
];

export interface EmailMessage {
  id: string;
  subject: string;
  body: string;
  direction: string;
  sender: string;
  recipient: string;
  timestamp: string;
  sourceType: "EMAIL";
}

interface BatchAssociationResponse {
  results: Array<{
    from: { id: string };
    to: Array<{ toObjectId: number; associationTypes: unknown[] }>;
  }>;
}

/**
 * Batch fetch email associations for many tickets at once.
 * Uses POST /crm/v4/associations/tickets/emails/batch/read (up to 1000 per request).
 * Returns a map: ticketId → emailId[]
 */
export async function batchGetEmailAssociations(
  ticketIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (ticketIds.length === 0) return result;

  const totalBatches = Math.ceil(ticketIds.length / 1000);
  for (let i = 0; i < ticketIds.length; i += 1000) {
    const batchNum = Math.floor(i / 1000) + 1;
    const batch = ticketIds.slice(i, i + 1000);
    console.log(`  Associations batch ${batchNum}/${totalBatches} (${i + batch.length}/${ticketIds.length} tickets)...`);
    try {
      const data = await hubspotFetch<BatchAssociationResponse>(
        "/crm/v4/associations/tickets/emails/batch/read",
        undefined,
        "POST",
        { inputs: batch.map((id) => ({ id })) },
      );
      for (const item of data.results) {
        const emailIds = item.to.map((t) => String(t.toObjectId));
        if (emailIds.length > 0) {
          result.set(item.from.id, emailIds);
        }
      }
    } catch (err) {
      console.warn(`  Warning: batch email associations failed at offset ${i}: ${err}`);
      // Fall back to individual lookups for this batch won't be done here;
      // tickets without associations will just have no emails
    }
  }

  return result;
}

/**
 * Batch fetch email details for a list of email IDs.
 * Uses SDK batch read (up to 100 per request).
 */
export async function batchFetchEmails(
  emailIds: string[],
): Promise<Map<string, EmailMessage>> {
  const result = new Map<string, EmailMessage>();
  if (emailIds.length === 0) return result;

  const client = getClient();

  const totalBatches = Math.ceil(emailIds.length / 100);
  for (let i = 0; i < emailIds.length; i += 100) {
    const batchNum = Math.floor(i / 100) + 1;
    if (batchNum % 10 === 1 || batchNum === totalBatches) {
      console.log(`  Email content batch ${batchNum}/${totalBatches} (${Math.min(i + 100, emailIds.length)}/${emailIds.length} emails)...`);
    }
    const batch = emailIds.slice(i, i + 100);
    try {
      const response = await client.crm.objects.emails.batchApi.read(
        {
          inputs: batch.map((id) => ({ id })),
          properties: EMAIL_PROPERTIES,
          propertiesWithHistory: [],
        },
        false,
      );
      for (const email of response.results) {
        const p = email.properties;
        const rawText = p.hs_email_text || p.hs_email_html || "";
        const bodyText = stripHtml(rawText);
        result.set(email.id, {
          id: email.id,
          subject: p.hs_email_subject || "",
          body: bodyText,
          direction: p.hs_email_direction || "UNKNOWN",
          sender: p.hs_email_sender_email || p.hs_email_from_email || "",
          recipient: p.hs_email_to_email || "",
          timestamp: p.hs_timestamp || "",
          sourceType: "EMAIL",
        });
      }
    } catch (err) {
      console.warn(`  Warning: batch email fetch failed at offset ${i}: ${err}`);
    }
  }

  return result;
}

/** Get emails for a single ticket given pre-fetched data. */
export function getEmailsForTicket(
  ticketId: string,
  associationMap: Map<string, string[]>,
  emailCache: Map<string, EmailMessage>,
): EmailMessage[] {
  const emailIds = associationMap.get(ticketId) || [];
  const messages: EmailMessage[] = [];
  for (const id of emailIds) {
    const email = emailCache.get(id);
    if (email) messages.push(email);
  }
  return messages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}
