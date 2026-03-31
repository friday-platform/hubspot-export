import "@std/dotenv/load";
import { fetchTicketProperties, fetchAllTickets } from "./tickets.ts";
import {
  batchGetEmailAssociations,
  batchFetchEmails,
  getEmailsForTicket,
} from "./emails.ts";
import { fetchConversationsForTicket } from "./conversations.ts";
import { DumpWriter } from "./export.ts";
import type { Message } from "./export.ts";
import { parallelMap } from "./hubspot.ts";

const OUTPUT_DIR = Deno.env.get("OUTPUT_DIR") || "./output";
const CONCURRENCY = (() => {
  const val = parseInt(Deno.env.get("CONCURRENCY") || "10");
  if (isNaN(val) || val < 1) {
    throw new Error(`Invalid CONCURRENCY value: "${Deno.env.get("CONCURRENCY")}". Must be a positive integer.`);
  }
  return val;
})();

async function main() {
  console.log("=== HubSpot Ticket + Conversation Dump ===\n");

  // 1. Discover properties and fetch all tickets
  const properties = await fetchTicketProperties();
  const tickets = await fetchAllTickets(properties);
  if (tickets.length === 0) {
    console.log("No tickets found. Check your access token and scopes.");
    return;
  }

  const allTicketIds = tickets.map((t) => t.id);

  // 2. Batch fetch email associations (1000 per request — ~47 calls for 47K tickets)
  console.log("\nFetching email associations in bulk...");
  const emailAssociations = await batchGetEmailAssociations(allTicketIds);
  const allEmailIds = [...new Set([...emailAssociations.values()].flat())];
  console.log(
    `Found ${allEmailIds.length} unique emails across ${emailAssociations.size} tickets.`,
  );

  // 3. Batch fetch all email content (100 per request)
  console.log("Fetching email content in bulk...");
  const emailCache = await batchFetchEmails(allEmailIds);
  console.log(`Fetched ${emailCache.size} emails.`);

  // 4. Fetch conversation threads per ticket (parallel with concurrency limit)
  console.log(
    `\nFetching conversation threads (concurrency: ${CONCURRENCY})...`,
  );
  const writer = await DumpWriter.create(OUTPUT_DIR, properties);
  let processed = 0;
  let totalEmails = 0;
  let totalConversations = 0;
  let errors = 0;
  const startTime = Date.now();

  await parallelMap(tickets, CONCURRENCY, async (ticket) => {
    try {
      const messages: Message[] = [];

      // Get emails from pre-fetched cache
      const emails = getEmailsForTicket(ticket.id, emailAssociations, emailCache);
      messages.push(...emails);
      totalEmails += emails.length;

      // Fetch conversation threads (per-ticket API call)
      try {
        const convos = await fetchConversationsForTicket(ticket.id);
        messages.push(...convos);
        totalConversations += convos.length;
      } catch (err) {
        console.warn(`  Warning: conversations for ticket ${ticket.id}: ${err}`);
      }

      // Sort all messages chronologically
      messages.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      await writer.writeTicket({ ticket, messages });
    } catch (err) {
      errors++;
      console.error(`  Error processing ticket ${ticket.id}: ${err}`);
    }

    processed++;
    if (processed % 200 === 0 || processed === tickets.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = rate > 0 ? Math.ceil((tickets.length - processed) / rate) : 0;
      const eta = remaining > 60
        ? `${Math.floor(remaining / 60)}m ${remaining % 60}s`
        : `${remaining}s`;
      console.log(
        `Progress: ${processed}/${tickets.length} (${((processed / tickets.length) * 100).toFixed(1)}%) | ` +
        `${totalEmails} emails, ${totalConversations} convos | ` +
        `${rate.toFixed(1)} tickets/s | ETA: ${processed < tickets.length ? eta : "done"}`,
      );
    }
  });

  await writer.close();
  const stats = writer.stats;

  console.log("\n=== Dump Complete ===");
  console.log(`Tickets:      ${stats.tickets}`);
  console.log(`Messages:     ${stats.messages}`);
  console.log(`  Emails:     ${totalEmails}`);
  console.log(`  Conversations: ${totalConversations}`);
  console.log(`Errors:       ${errors}`);
  console.log(`Output dir:   ${OUTPUT_DIR}/`);
  console.log(`  tickets.csv   - ticket metadata`);
  console.log(`  messages.csv  - all conversation messages`);
  console.log(`  dump.jsonl    - full structured data`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
