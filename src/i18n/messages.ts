import { en, type MessageKey } from './en';
import { ko } from './ko';

export type Lang = 'en' | 'ko';
export type { MessageKey };

export const TABLES: Record<Lang, Record<MessageKey, string>> = { en, ko };

export function isLang(value: string): value is Lang {
  return value === 'en' || value === 'ko';
}

/** Anything starting with "ko" (ko, ko_KR.UTF-8, ko-KR) is Korean; everything else is English. */
export function langFromLocale(locale: string | undefined): Lang {
  return locale !== undefined && /^ko/i.test(locale.trim()) ? 'ko' : 'en';
}

export interface LangInputs {
  /** Command-line arguments (`--lang ko` or `--lang=ko` is looked up here). */
  argv?: readonly string[];
  /** Environment variables. The CLI passes `process.env`; tests pass a plain object. */
  env: Record<string, string | undefined>;
}

/** The last valid `--lang` value in argv (invalid values are left to the argument parser). */
export function langFlag(argv: readonly string[]): Lang | undefined {
  let flag: Lang | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = a === '--lang' ? argv[i + 1] : a.startsWith('--lang=') ? a.slice('--lang='.length) : undefined;
    if (v !== undefined && isLang(v)) flag = v;
  }
  return flag;
}

/** `--lang` > CHAT_RELINK_LANG > LC_ALL > LC_MESSAGES > LANG; not Korean (or nothing set) means English. */
export function resolveLang({ argv = [], env }: LangInputs): Lang {
  const flag = langFlag(argv);
  if (flag) return flag;
  const own = env.CHAT_RELINK_LANG;
  if (own && isLang(own.trim().toLowerCase())) return own.trim().toLowerCase() as Lang;
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const v = env[name];
    if (v) return langFromLocale(v);
  }
  return 'en';
}

export type Params = Record<string, string | number>;

export function t(lang: Lang, key: MessageKey, params: Params = {}): string {
  const text = TABLES[lang][key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Bind a language once: `const m = translator('ko'); m('scan.none')`. */
export function translator(lang: Lang): (key: MessageKey, params?: Params) => string {
  return (key, params) => t(lang, key, params);
}
