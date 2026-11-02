/**
 * Safe arithmetic for the universal bar: a tokenizer and a recursive-descent parser, never
 * `eval`. Numbers (decimal point or comma), + - * / % ^ and parentheses; nothing else is accepted.
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/" | "%") unary)*      % between two operands: modulo
 *   unary   := ("+" | "-") unary | power
 *   power   := postfix ("^" unary)?                   right-associative, binds tighter than unary minus
 *   postfix := primary "%"*                           % with no operand after it: percent (÷ 100)
 *   primary := number | "(" expr ")"
 */

type Token = { type: "number"; value: number } | { type: "op"; value: string };

const MAX_INPUT = 200;
const MAX_DEPTH = 32;
const OPERATORS = new Set(["+", "-", "*", "/", "%", "^", "(", ")"]);
const ALIASES: Record<string, string> = { "×": "*", "÷": "/", "−": "-", "–": "-", "·": "*" };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const number = /^(\d+([.,]\d+)?|[.,]\d+)/.exec(input.slice(i));
    if (number) {
      tokens.push({ type: "number", value: Number(number[0].replace(",", ".")) });
      i += number[0].length;
      continue;
    }
    const op = ALIASES[char] ?? char;
    if (!OPERATORS.has(op)) return null;
    tokens.push({ type: "op", value: op });
    i++;
  }
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;
  /** Binary operators and percents seen: a lone number is not a calculation. */
  operations = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expr();
    if (this.index !== this.tokens.length) throw new Error("trailing input");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isOp(value: string, token = this.peek()): boolean {
    return token?.type === "op" && token.value === value;
  }

  private expr(): number {
    if (++this.depth > MAX_DEPTH) throw new Error("too deep");
    let value = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.index++] as { value: string }).value;
      this.operations++;
      const right = this.term();
      value = op === "+" ? value + right : value - right;
    }
    this.depth--;
    return value;
  }

  private term(): number {
    let value = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = (this.tokens[this.index++] as { value: string }).value;
      this.operations++;
      const right = this.unary();
      if ((op === "/" || op === "%") && right === 0) throw new Error("division by zero");
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  }

  private unary(): number {
    if (this.isOp("-") || this.isOp("+")) {
      const negative = this.isOp("-");
      this.index++;
      if (++this.depth > MAX_DEPTH) throw new Error("too deep");
      const value = this.unary();
      this.depth--;
      return negative ? -value : value;
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (!this.isOp("^")) return base;
    this.index++;
    this.operations++;
    if (++this.depth > MAX_DEPTH) throw new Error("too deep");
    const exponent = this.unary();
    this.depth--;
    return base ** exponent;
  }

  private postfix(): number {
    let value = this.primary();
    // "%" not followed by an operand is a percent; before a number or "(", it is the modulo (term).
    while (this.isOp("%")) {
      const next = this.tokens[this.index + 1];
      if (next && (next.type === "number" || this.isOp("(", next))) break;
      this.index++;
      this.operations++;
      value /= 100;
    }
    return value;
  }

  private primary(): number {
    const token = this.peek();
    if (token?.type === "number") {
      this.index++;
      return token.value;
    }
    if (this.isOp("(")) {
      this.index++;
      const value = this.expr();
      if (!this.isOp(")")) throw new Error("missing )");
      this.index++;
      return value;
    }
    throw new Error("operand expected");
  }
}

/**
 * The value of an arithmetic expression, or null when the text is anything else (letters,
 * functions, a lone number, a division by zero, an infinite or unrepresentable result).
 */
export function evaluate(input: string): number | null {
  const text = input.trim().replace(/^=\s*/, "");
  if (!text || text.length > MAX_INPUT) return null;
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return null;
  const parser = new Parser(tokens);
  try {
    const value = parser.parse();
    return parser.operations > 0 && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A number for display and copy: 12 significant digits (no float noise like 0.30000000000000004),
 * no grouping, the decimal separator given (French uses a comma).
 */
export function formatNumber(value: number, decimal = ","): string {
  const rounded = Number(value.toPrecision(12));
  const text = Object.is(rounded, -0) ? "0" : String(rounded);
  return text.replace(".", decimal);
}

/** The decimal separator the user typed (a point if any), else the French comma. */
export const decimalOf = (input: string) => (/\d\.\d/.test(input) && !/\d,\d/.test(input) ? "." : ",");
