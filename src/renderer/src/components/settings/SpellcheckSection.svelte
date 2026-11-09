<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
  import { MAX_SPELL_LANGUAGES } from "@shared/settings";
  import { isDictionaryWord, spellLanguageName } from "@shared/spellcheck";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * "Orthographe" (ADR-041): spell checking on or off, its dictionaries (Windows and Linux; macOS
   * uses the system's languages) and the words added with "Ajouter au dictionnaire".
   */
  const s = $derived(settings.current.spellcheck);

  let available = $state<string[]>([]);
  let current = $state<string[]>([]);
  let words = $state<string[]>([]);
  let draft = $state("");

  const refreshLanguages = () =>
    api.spellcheck.languages().then(
      (next) => ((available = next.available), (current = next.current)),
      () => null,
    );
  const refreshWords = () => (browser.isPrivate ? null : api.spellcheck.words().then((next) => (words = next), () => null));
  $effect(() => {
    void refreshLanguages();
    void refreshWords();
  });
  // The dictionaries in use follow the setting (main applies it to every session).
  $effect(() => {
    void s.languages;
    void s.enabled;
    const timer = setTimeout(refreshLanguages, 150);
    return () => clearTimeout(timer);
  });

  /** Chosen ones first, then the others, by name. */
  const sorted = $derived([...available].sort((a, b) => Number(s.languages.includes(b)) - Number(s.languages.includes(a)) || spellLanguageName(a).localeCompare(spellLanguageName(b), intlLocale())));

  function toggleLanguage(code: string, on: boolean): void {
    const base = s.languages.length ? s.languages : current;
    const next = on ? [...new Set([...base, code])] : base.filter((item) => item !== code);
    settings.update({ spellcheck: { languages: next.slice(0, MAX_SPELL_LANGUAGES) } });
  }

  async function addWord(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const word = draft.trim();
    if (!isDictionaryWord(word)) return;
    await api.spellcheck.addWord(word).catch(() => null);
    draft = "";
    await refreshWords();
  }

  async function removeWord(word: string): Promise<void> {
    await api.spellcheck.removeWord(word).catch(() => null);
    await refreshWords();
  }
</script>

<Row anchor="enabled" label={t("spellcheckSection.checkSpelling")} hint={t("spellcheckSection.underlinesMistakesTextFields")} keywords={t("spellcheckSection.spellCheckerMistakesSpelling")}>
  <Toggle label={t("spellcheckSection.checkSpelling")} checked={s.enabled} onchange={(enabled) => settings.update({ spellcheck: { enabled } })} />
</Row>
<Row
  anchor="languages"
  label={t("spellcheckSection.languages")}
  hint={available.length
    ? t("spellcheckSection.upDictionariesDownloadedFirst", { MAX_SPELL_LANGUAGES })
    : t("spellcheckSection.systemLanguagesCheckFollow")}
  stacked
  keywords={t("spellcheckSection.dictionaryLanguageFrenchEnglish")}
>
  {#if available.length}
    <div class="languages" data-testid="spellcheck-languages">
      {#each sorted as code (code)}
        <Checkbox checked={(s.languages.length ? s.languages : current).includes(code)} onchange={(on) => toggleLanguage(code, on)}>
          <span data-code={code}>{spellLanguageName(code)}</span>
        </Checkbox>
      {/each}
    </div>
  {/if}
</Row>
{#if !browser.isPrivate}
  <Row anchor="words" label={t("spellcheckSection.wordsAddedDictionary")} stacked keywords={t("spellcheckSection.personalDictionaryWords")}>
    {#if words.length}
      <Card aria-label={t("spellcheckSection.addedWords")}>
        {#each words as word (word)}
          <ListRow dense>
            <span class="word">{word}</span>
            <IconButton icon="close" size="row" label={t("spellcheckSection.removeFromDictionary", { word })} onclick={() => removeWord(word)} />
          </ListRow>
        {/each}
      </Card>
    {/if}
    <form class="add" onsubmit={addWord}>
      <input class="ui-field" aria-label={t("spellcheckSection.wordAdd")} placeholder={t("spellcheckSection.addWord")} maxlength="64" bind:value={draft} />
      <Button type="submit" disabled={!isDictionaryWord(draft.trim())}><Icon name="plus" size={12} /> {t("spellcheckSection.add")}</Button>
    </form>
  </Row>
{/if}

<style>
  .languages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-1) var(--space-3);
    max-height: 240px;
    overflow: auto;
  }
  .word {
    flex: 1;
    font-size: var(--text-sm);
  }
  .add {
    display: flex;
    gap: var(--space-2);
  }
  .add input {
    flex: 1;
  }
</style>
