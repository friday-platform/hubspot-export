import type { Ticket, TicketProperty } from "./tickets.ts";
import type { EmailMessage } from "./emails.ts";
import type { ConversationMessage } from "./conversations.ts";

export type Message = EmailMessage | ConversationMessage;

export interface TicketDump {
  ticket: Ticket;
  messages: Message[];
}

const MESSAGES_CSV_HEADER = [
  "ticket_id",
  "message_id",
  "timestamp",
  "direction",
  "sender",
  "recipient",
  "subject",
  "body",
  "source_type",
  "thread_id",
].join(",");

/** Escape a value for CSV (RFC 4180). */
function csvEscape(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const HUBSPOT_PORTAL = Deno.env.get("HUBSPOT_PORTAL_ID");
if (!HUBSPOT_PORTAL) {
  throw new Error(
    "HUBSPOT_PORTAL_ID is not set. Add it to your .env file. Find it in your HubSpot URL: app.hubspot.com/contacts/{portal_id}/...",
  );
}

export class DumpWriter {
  private ticketsFile: Deno.FsFile;
  private messagesFile: Deno.FsFile;
  private jsonlFile: Deno.FsFile;
  private encoder = new TextEncoder();
  private ticketCount = 0;
  private messageCount = 0;
  private properties: TicketProperty[];

  private constructor(
    ticketsFile: Deno.FsFile,
    messagesFile: Deno.FsFile,
    jsonlFile: Deno.FsFile,
    properties: TicketProperty[],
  ) {
    this.ticketsFile = ticketsFile;
    this.messagesFile = messagesFile;
    this.jsonlFile = jsonlFile;
    this.properties = properties;
  }

  static async create(
    outputDir: string,
    properties: TicketProperty[],
  ): Promise<DumpWriter> {
    await Deno.mkdir(outputDir, { recursive: true });

    const ticketsFile = await Deno.open(`${outputDir}/tickets.csv`, {
      write: true,
      create: true,
      truncate: true,
    });
    const messagesFile = await Deno.open(`${outputDir}/messages.csv`, {
      write: true,
      create: true,
      truncate: true,
    });
    const jsonlFile = await Deno.open(`${outputDir}/dump.jsonl`, {
      write: true,
      create: true,
      truncate: true,
    });

    const writer = new DumpWriter(ticketsFile, messagesFile, jsonlFile, properties);

    // Build ticket CSV header from property labels + extras
    const headers = properties.map((p) => p.label);
    headers.push("Message Count", "URL");
    await writer.writeLine(ticketsFile, headers.map(csvEscape).join(","));

    await writer.writeLine(messagesFile, MESSAGES_CSV_HEADER);
    return writer;
  }

  private async writeLine(file: Deno.FsFile, line: string): Promise<void> {
    await file.write(this.encoder.encode(line + "\n"));
  }

  async writeTicket(dump: TicketDump): Promise<void> {
    const { ticket, messages } = dump;
    const url = `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL}/ticket/${ticket.id}`;

    // Build ticket CSV row from properties in order + extras
    const values = this.properties.map((p) => ticket.properties[p.name] ?? "");
    values.push(String(messages.length), url);

    await this.writeLine(this.ticketsFile, values.map(csvEscape).join(","));
    this.ticketCount++;

    // Write message CSV rows
    for (const msg of messages) {
      const threadId = "threadId" in msg ? msg.threadId : "";
      const msgRow = [
        ticket.id,
        msg.id,
        msg.timestamp,
        msg.direction,
        msg.sender,
        msg.recipient,
        msg.subject,
        msg.body,
        msg.sourceType,
        threadId,
      ]
        .map(csvEscape)
        .join(",");

      await this.writeLine(this.messagesFile, msgRow);
      this.messageCount++;
    }

    // Write JSONL
    await this.writeLine(this.jsonlFile, JSON.stringify(dump));
  }

  async close(): Promise<void> {
    this.ticketsFile.close();
    this.messagesFile.close();
    this.jsonlFile.close();
  }

  get stats(): { tickets: number; messages: number } {
    return { tickets: this.ticketCount, messages: this.messageCount };
  }
}
