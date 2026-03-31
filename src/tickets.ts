import { getClient } from "./hubspot.ts";

export interface TicketProperty {
  name: string;
  label: string;
}

export interface Ticket {
  id: string;
  properties: Record<string, string | null>;
}

/** Fetch all property definitions for tickets. */
export async function fetchTicketProperties(): Promise<TicketProperty[]> {
  const client = getClient();
  console.log("Fetching ticket property definitions...");
  const response = await client.crm.properties.coreApi.getAll("tickets");
  const props = response.results
    .map((p) => ({ name: p.name, label: p.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  console.log(`Found ${props.length} ticket properties.`);
  return props;
}

/** Fetch all tickets with manual pagination and progress logging. */
export async function fetchAllTickets(
  properties: TicketProperty[],
): Promise<Ticket[]> {
  const client = getClient();
  const propertyNames = properties.map((p) => p.name);
  const tickets: Ticket[] = [];
  let after: string | undefined;
  let page = 0;

  console.log("Fetching all tickets...");
  const startTime = Date.now();

  do {
    const response = await client.crm.tickets.basicApi.getPage(
      100,
      after,
      propertyNames,
      undefined,
      undefined,
      false,
    );

    for (const t of response.results) {
      tickets.push({ id: t.id, properties: t.properties });
    }

    after = response.paging?.next?.after;
    page++;

    if (page % 50 === 0 || !after) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ...${tickets.length} tickets fetched (${elapsed}s elapsed)`);
    }
  } while (after);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Fetched ${tickets.length} tickets in ${totalTime}s.`);

  return tickets;
}
