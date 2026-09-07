import type { SupabaseClient } from "@supabase/supabase-js";

// A minimal in-memory stand-in for the Supabase client, supporting exactly
// the query shapes sync.ts uses against `executive_orders`. Exists only so
// syncDocument's insert/update/flag decisions can be unit tested without a
// real database — the payoff of passing the client in as a parameter
// (dependency injection) rather than sync.ts creating its own. Deliberately
// a much narrower shape than the real SupabaseClient, cast below — this
// file is test-only and never imported from production code.

type Row = Record<string, unknown> & { id?: string };
type Predicate = (row: Row) => boolean;

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
  constructor(private rows: Row[]) {}

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

  async maybeSingle() {
    const data = this.rows.find((row) => this.predicates.every((p) => p(row))) ?? null;
    return { data, error: null };
  }

  async limit(count: number) {
    const data = this.rows.filter((row) => this.predicates.every((p) => p(row))).slice(0, count);
    return { data, error: null };
  }
}

class FakeUpdateBuilder {
  constructor(
    private rows: Row[],
    private patch: Record<string, unknown>,
  ) {}

  async eq(column: string, value: unknown) {
    const row = this.rows.find((r) => r[column] === value);
    if (row) Object.assign(row, this.patch);
    return { error: null };
  }
}

export interface FakeSupabase {
  rows: Row[];
}

/** Returns an object satisfying just the SupabaseClient surface sync.ts calls, cast for use in tests. */
export function createFakeSupabase({ rows }: { rows: Row[] }): SupabaseClient & FakeSupabase {
  const client = {
    rows,
    from() {
      return {
        select: () => new FakeQueryBuilder(rows),
        insert: async (record: Record<string, unknown>) => {
          rows.push({ ...record });
          return { error: null };
        },
        update: (patch: Record<string, unknown>) => new FakeUpdateBuilder(rows, patch),
      };
    },
  };
  return client as unknown as SupabaseClient & FakeSupabase;
}
