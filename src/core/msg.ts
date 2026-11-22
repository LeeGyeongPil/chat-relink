import { t, type Lang, type MessageKey, type Params } from '../i18n/messages';

/**
 * Language of the messages the core builds (errors, warnings, verification failures).
 * The CLI and the extension set it once per run; library users get English by default.
 */
let coreLang: Lang = 'en';

export function setCoreLang(lang: Lang): void {
  coreLang = lang;
}

export function getCoreLang(): Lang {
  return coreLang;
}

/** Translate a core message into the current core language. */
export function cm(key: MessageKey, params: Params = {}): string {
  return t(coreLang, key, params);
}
