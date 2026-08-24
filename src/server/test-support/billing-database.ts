import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

export const BILLING_TEST_SCHEMA = `
  create table user (
    id text primary key,
    terms_accepted_at integer,
    terms_version text,
    updated_at integer not null default 0
  );
  create table billing_operation (
    user_id text primary key references user(id) on delete cascade,
    state text not null,
    token text,
    expires_at integer not null,
    constraint billing_operation_state_check check (
      (state = 'checkout_open' and token is null)
      or (state = 'checkout_completed' and token is null)
      or (state in ('checkout_claimed', 'checkout_completed_claimed', 'deleting')
        and token is not null)
    )
  );
`;

export async function createBillingTestDatabase() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(BILLING_TEST_SCHEMA);
  await client.execute("insert into user (id) values ('user-1')");
  return { client, database: drizzle(client) };
}
