// Lecture des fichiers SavedVariables de WoW (WTF/Account/<COMPTE>/SavedVariables/*.lua).
// Le fichier n'est jamais exécuté : on analyse le seul sous-ensemble de Lua que le jeu
// écrit (affectations globales de tables, chaînes, nombres, booléens, nil, commentaires).

export type LuaValue = string | number | boolean | null | LuaTable;
export interface LuaTable {
	/** Éléments sans clé ([1], [2]…), dans l'ordre. */
	list: LuaValue[];
	/** Éléments à clé chaîne ou à clé numérique hors séquence. */
	fields: Record<string, LuaValue>;
}

export class LuaParseError extends Error {}

const MAX_DEPTH = 64;
const utf8 = new TextDecoder();

/** Variables globales du fichier : `Nom = valeur`. */
export function parseSavedVariables(source: string): Record<string, LuaValue> {
	const p = new Parser(source);
	const globals: Record<string, LuaValue> = {};
	p.skip();
	while (!p.end()) {
		const name = p.identifier();
		p.expect('=');
		globals[name] = p.value(0);
		p.skip();
		if (p.peek() === ';') p.pos++;
		p.skip();
	}
	return globals;
}

/** Table Lua → objet JS : les listes deviennent des tableaux, le reste des objets. */
export function toPlain(value: LuaValue): unknown {
	if (value === null || typeof value !== 'object') return value;
	const keys = Object.keys(value.fields);
	if (keys.length === 0) return value.list.map(toPlain);
	const out: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, toPlain(value.fields[k])]));
	value.list.forEach((v, i) => (out[String(i + 1)] = toPlain(v)));
	return out;
}

class Parser {
	pos = 0;
	constructor(private s: string) {}

	end() {
		return this.pos >= this.s.length;
	}
	peek() {
		return this.s[this.pos];
	}
	fail(msg: string): never {
		const line = this.s.slice(0, this.pos).split('\n').length;
		throw new LuaParseError(`${msg} (ligne ${line})`);
	}

	/** Espaces et commentaires (`-- …` et `--[[ … ]]`). */
	skip() {
		for (;;) {
			while (!this.end() && /\s/.test(this.peek())) this.pos++;
			if (this.s.startsWith('--[[', this.pos)) {
				const close = this.s.indexOf(']]', this.pos);
				this.pos = close < 0 ? this.s.length : close + 2;
			} else if (this.s.startsWith('--', this.pos)) {
				const nl = this.s.indexOf('\n', this.pos);
				this.pos = nl < 0 ? this.s.length : nl + 1;
			} else return;
		}
	}

	expect(ch: string) {
		this.skip();
		if (this.peek() !== ch) this.fail(`« ${ch} » attendu`);
		this.pos++;
	}

	identifier() {
		this.skip();
		const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.pos, this.pos + 200));
		if (!m) this.fail('Nom de variable attendu');
		this.pos += m[0].length;
		return m[0];
	}

	value(depth: number): LuaValue {
		if (depth > MAX_DEPTH) this.fail('Imbrication trop profonde');
		this.skip();
		const c = this.peek();
		if (c === '{') return this.table(depth);
		if (c === '"' || c === "'") return this.string();
		if (c === '-' || c === '.' || /\d/.test(c ?? '')) return this.number();
		const word = this.identifier();
		if (word === 'true') return true;
		if (word === 'false') return false;
		if (word === 'nil') return null;
		this.fail(`Valeur inattendue « ${word} »`);
	}

	table(depth: number): LuaTable {
		this.expect('{');
		const t: LuaTable = { list: [], fields: {} };
		for (;;) {
			this.skip();
			if (this.peek() === '}') {
				this.pos++;
				return t;
			}
			if (this.peek() === '[') {
				this.pos++;
				const key = this.value(depth + 1);
				this.expect(']');
				this.expect('=');
				const v = this.value(depth + 1);
				// WoW écrit les listes avec des clés [1], [2]… : on les remet dans l'ordre.
				if (typeof key === 'number' && key === t.list.length + 1) t.list.push(v);
				else t.fields[String(key)] = v;
			} else if (/[A-Za-z_]/.test(this.peek() ?? '') && /^[A-Za-z_]\w*\s*=(?!=)/.test(this.s.slice(this.pos, this.pos + 200))) {
				const key = this.identifier();
				this.expect('=');
				t.fields[key] = this.value(depth + 1);
			} else {
				t.list.push(this.value(depth + 1));
			}
			this.skip();
			if (this.peek() === ',' || this.peek() === ';') this.pos++;
			else if (this.peek() !== '}') this.fail('« , » ou « } » attendu');
		}
	}

	string(): string {
		const quote = this.s[this.pos++];
		let out = '';
		// Octets écrits en \ddd, décodés ensemble : un caractère accentué en UTF-8 en prend deux.
		let bytes: number[] = [];
		const flush = () => {
			if (bytes.length) out += utf8.decode(Uint8Array.from(bytes));
			bytes = [];
		};
		while (!this.end()) {
			const c = this.s[this.pos++];
			if (c === quote) {
				flush();
				return out;
			}
			if (c !== '\\') {
				flush();
				out += c;
				continue;
			}
			const e = this.s[this.pos++];
			const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
			if (/\d/.test(e)) {
				// \ddd : octet en décimal (WoW écrit l'UTF-8 octet par octet pour %q).
				let digits = e;
				while (digits.length < 3 && /\d/.test(this.peek() ?? '')) digits += this.s[this.pos++];
				const byte = Number(digits);
				if (byte > 255) this.fail('Octet invalide');
				bytes.push(byte);
				continue;
			}
			flush();
			out += e in simple ? simple[e] : e;
		}
		this.fail('Chaîne non terminée');
	}

	number(): number {
		const m = /^-?(0x[0-9a-fA-F]+|\d*\.?\d+(?:[eE][-+]?\d+)?|\d+\.)/.exec(this.s.slice(this.pos, this.pos + 64));
		if (!m) this.fail('Nombre invalide');
		this.pos += m[0].length;
		const n = Number(m[0]);
		if (Number.isNaN(n)) this.fail('Nombre invalide');
		return n;
	}
}
