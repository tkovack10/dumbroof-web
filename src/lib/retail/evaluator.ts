/**
 * Safe arithmetic evaluator for retail-template `quantity_formula` strings.
 *
 * Templates contain expressions like:
 *   "roof_area_sq"
 *   "eave_lf + rake_lf"
 *   "((eave_lf * 6) + (valley_lf * 3)) / 100"
 *
 * We can't use Function/eval — those execute arbitrary JS. Instead, this
 * tokenizer + recursive-descent parser supports:
 *   - numeric literals (123, 1.5)
 *   - identifiers (resolved against the variables map)
 *   - + - * / operators with correct precedence
 *   - parentheses
 *   - a fixed allow-list of math functions: max, min, round, floor, ceil
 *     (e.g. "max(2, round(eave_lf / 35))" for retail gutter downspout counts)
 *
 * Anything else (property access, comparison, unknown functions, etc.) throws.
 * Missing variables resolve to 0 (so partial measurements don't blow up the UI).
 */

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  max: (a) => (a.length ? Math.max(...a) : 0),
  min: (a) => (a.length ? Math.min(...a) : 0),
  round: (a) => Math.round(a[0] ?? 0),
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
};

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: "num", value: parseFloat(input.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at position ${i}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private vars: Record<string, number>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private consume(): Token {
    return this.tokens[this.pos++];
  }

  // expr = term (('+' | '-') term)*
  expr(): number {
    let left = this.term();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== "op" || (t.value !== "+" && t.value !== "-")) break;
      this.consume();
      const right = this.term();
      left = t.value === "+" ? left + right : left - right;
    }
    return left;
  }

  // term = factor (('*' | '/') factor)*
  term(): number {
    let left = this.factor();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== "op" || (t.value !== "*" && t.value !== "/")) break;
      this.consume();
      const right = this.factor();
      left = t.value === "*" ? left * right : right === 0 ? 0 : left / right;
    }
    return left;
  }

  // factor = num | ident | '(' expr ')' | '-' factor
  factor(): number {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "num") {
      this.consume();
      return t.value;
    }
    if (t.type === "ident") {
      this.consume();
      // Function call: ident '(' expr (',' expr)* ')' against the allow-list.
      if (this.peek()?.type === "lparen") {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new Error(`Unknown function '${t.value}'`);
        return fn(this.parseArgs());
      }
      return this.vars[t.value] ?? 0; // missing vars default to 0
    }
    if (t.type === "lparen") {
      this.consume();
      const value = this.expr();
      const next = this.consume();
      if (next?.type !== "rparen") throw new Error("Expected ')'");
      return value;
    }
    if (t.type === "op" && t.value === "-") {
      this.consume();
      return -this.factor();
    }
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }

  // Parse a function arg list: '(' expr (',' expr)* ')'. Assumes the current
  // token is the opening '('.
  private parseArgs(): number[] {
    this.consume(); // '('
    const args: number[] = [];
    if (this.peek()?.type === "rparen") {
      this.consume();
      return args;
    }
    args.push(this.expr());
    while (this.peek()?.type === "comma") {
      this.consume();
      args.push(this.expr());
    }
    const next = this.consume();
    if (next?.type !== "rparen") throw new Error("Expected ')' to close function call");
    return args;
  }
}

export function evaluateFormula(
  formula: string,
  variables: Record<string, number>,
): number {
  if (!formula || formula.trim() === "") return 0;
  try {
    const tokens = tokenize(formula);
    if (tokens.length === 0) return 0;
    const parser = new Parser(tokens, variables);
    const value = parser.expr();
    if (!Number.isFinite(value)) return 0;
    return value;
  } catch (err) {
    console.warn(`[retail-evaluator] failed to evaluate "${formula}":`, err);
    return 0;
  }
}
