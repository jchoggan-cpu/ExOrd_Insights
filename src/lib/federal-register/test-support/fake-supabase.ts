import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// A minimal in-memory stand-in for the Supabase client, supporting exactly
// the query shapes this project's Federal Register code uses (sync.ts,
// reconcile-legacy.ts, ingestion-run.ts, and the three job orchestrators).
// Exists only so that logic can be unit tested without a real database —
// the payoff of passing the client in as a parameter (dependency injection)
// rather than reaching for it. Deliberately a much narrower shape than the
// real SupabaseClient, cast below — this file is test-only and never
// imported from production code.

type Row = Record<string, unknown> & { id?: string };
type Predicate = (row: Row) => boolean;
type QueryResult<T> = { data: T | null; error: { message: string } | null };

function parseOrFilter(filterString: string): Predicate {
  const clauses = filterString.split(",").map((clause) => {
    const [column, operator, ...rest] = clause.split(".");
    return { column, operator, value: rest.join(".") };
  });
  return (row) =>
    clauses.some(({ column, operator, value }) => {
      if (operator === "eq") return String(row[column]) === value;
      if (operator === "cs") {
        const inner = value.slice(1, -1); // "{2026-03829}" -> "2026-03829"
        const arr = row[column];
        return Array.isArray(arr) && arr.includes(inner);
      }
      return false;
    });
}

class FakeQueryBuilder {
  private predicates: Predicate[] = [];
  constructor(
    private rows: Row[],
    private forcedError?: string,
  ) {}

  eq(column: string, value: unknown) {
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  or(filterString: string) {
    this.predicates.push(parseOrFilter(filterString));
    return this;
  }

  not(column: string, _operator: "is", value: null) {
    this.predicates.push((row) => row[column] !== value);
    return this;
  }

  is(column: string, value: unknown) {
    this.predicates.push((row) => (row[column] ?? null) === value);
    return this;
  }

  private matching(): Row[] {
    return this.rows.filter((row) => this.predicates.every((p) => p(row)));
  }

  async maybeSingle(): Promise<QueryResult<Row>> {
    if (this.forcedError) return { data: null, error: { message: this.forcedError } };
    return { data: this.matching()[0] ?? null, error: null };
  }

  async limit(count: number): Promise<QueryResult<Row[]>> {
    if (this.forcedError) return { data: null, error: { message: this.forcedError } };
    return { data: this.matching().slice(0, count), error: null };
  }

  // Real supabase-js query builders are themselves thenable — awaiting one
  // directly (with no .maybeSingle()/.limit() terminal call) runs the query
  // and resolves to { data, error }. reconcile-job.ts relies on that shape.
  then<TResult1, TResult2 = never>(
    onFulfilled?: ((value: QueryResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result: QueryResult<Row[]> = this.forcedError
      ? { data: null, error: { message: this.forcedError } }
      : { data: this.matching(), error: null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

class FakeUpdateBuilder {
  constructor(
    private rows: Row[],
    private patch: Record<string, unknown>,
    private forcedError?: string,
  ) {}

  async eq(column: string, value: unknown) {
    if (this.forcedError) return { error: { message: this.forcedError } };
    const row = this.rows.find((r) => r[column] === value);
    if (row) Object.assign(row, this.patch);
    return { error: null };
  }
}

class FakeInsertSelectBuilder {
  constructor(
    private rows: Row[],
    private insertedRow: Row,
  ) {}

  async single(): Promise<QueryResult<{ id: string }>> {
    this.rows.push(this.insertedRow);
    return { data: { id: this.insertedRow.id as string }, error: null };
  }
}

class FakeInsertBuilder {
  private insertedRow: Row;
  constructor(
    private rows: Row[],
    record: Record<string, unknown>,
  ) {
    // Mirrors ingestion_runs' real `started_at timestamptz not null default
    // now()` — startRun's insert never sets this column itself, so the fake
    // must default it too, or every inserted run row would be missing the
    // timestamp startRun's staleness check reads.
    this.insertedRow = { id: randomUUID(), started_at: new Date().toISOString(), ...record };
  }

  /** Chained form: `.insert(record).select("id").single()` — used by ingestion-run.ts's startRun. */
  select() {
    return new FakeInsertSelectBuilder(this.rows, this.insertedRow);
  }

  // Bare form: `await supabase.from(...).insert(record)` with no .select() —
  // used by sync.ts. Only one of these two paths is ever exercised per call.
  then<TResult1, TResult2 = never>(
    onFulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.rows.push(this.insertedRow);
    return Promise.resolve({ error: null } as const).then(onFulfilled, onRejected);
  }
}

export interface FakeSupabase {
  rows: Row[];
  ingestionRuns: Row[];
}

/**
 * Returns an object satisfying just the SupabaseClient surface this
 * project's Federal Register code calls, cast for use in tests.
 *
 * `rows` backs the `executive_orders` table (kept as a top-level property
 * for the existing tests that read `supabase.rows`); `ingestionRuns` backs
 * `ingestion_runs`. `failSelect` forces every select-query terminal call
 * (`.maybeSingle()`, `.limit()`, or a bare `await`) against the named table
 * to return `{ data: null, error: { message } }`, for simulating "the list
 * request itself failed" scenarios. `failUpdate` does the same for
 * `.update(...).eq(...)` — for simulating finishRun's own write failing.
 */
export function createFakeSupabase({
  rows = [],
  ingestionRuns = [],
  failSelect = {},
  failUpdate = {},
}: {
  rows?: Row[];
  ingestionRuns?: Row[];
  failSelect?: Partial<Record<string, string>>;
  failUpdate?: Partial<Record<string, string>>;
}): SupabaseClient & FakeSupabase {
  const tables: Record<string, Row[]> = {
    executive_orders: rows,
    ingestion_runs: ingestionRuns,
  };

  const client = {
    rows,
    ingestionRuns,
    from(table: string) {
      const tableRows = tables[table] ?? (tables[table] = []);
      return {
        select: () => new FakeQueryBuilder(tableRows, failSelect[table]),
        insert: (record: Record<string, unknown>) => new FakeInsertBuilder(tableRows, record),
        update: (patch: Record<string, unknown>) => new FakeUpdateBuilder(tableRows, patch, failUpdate[table]),
      };
    },
  };
  return client as unknown as SupabaseClient & FakeSupabase;
}
