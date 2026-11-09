<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
  import type { SiteInfo } from "@shared/site-info";
  import Icon from "../../components/Icon.svelte";

  /** Whether the connection is encrypted, and the certificate of a secure one. */
  let { certificate, secure }: { certificate: SiteInfo["certificate"]; secure: boolean } = $props();

  const dateFormat = new Intl.DateTimeFormat(intlLocale(), { dateStyle: "long" });
  const date = (ms: number) => dateFormat.format(new Date(ms));
</script>

<section class="kit-section" aria-label={t("connectionSection.connection")}>
  {#if secure}
    <p class="note">{t("connectionSection.informationExchangedSitePasswords")}</p>
    {#if certificate}
      <details class="certificate">
        <summary><Icon name="certificate" size={12} /> {t("connectionSection.certificate")}</summary>
        <dl>
          <dt>{t("connectionSection.issued")}</dt>
          <dd>{certificate.subject}</dd>
          <dt>{t("connectionSection.issued2")}</dt>
          <dd>{certificate.issuer}</dd>
          <dt>{t("connectionSection.validity")}</dt>
          <dd>{t("connectionSection.from", { p: date(certificate.validFrom), p2: date(certificate.validTo) })}</dd>
          <dt>{t("connectionSection.fingerprint")}</dt>
          <dd class="kit-code wrap">{certificate.fingerprint}</dd>
        </dl>
      </details>
    {:else}
      <p class="kit-hint">{t("connectionSection.certificateDetailsUnavailableConnection")}</p>
    {/if}
  {:else}
    <p class="note warn">{t("connectionSection.dontEnterSensitiveInformation")}</p>
  {/if}
</section>

<style>
  .note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .note.warn {
    color: var(--text);
  }
  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    width: fit-content;
    padding: 3px 6px;
    margin-left: -6px;
    border-radius: 6px;
    color: var(--accent-text);
    font-size: var(--text-xs);
    cursor: pointer;
    list-style: none;
  }
  summary:hover {
    background: var(--surface-hover);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 6px 0 0;
    font-size: var(--text-xs);
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
