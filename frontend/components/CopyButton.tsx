"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { useI18n } from "@/components/I18nProvider";

// Copies a value (e.g. a revision sha) and confirms for a moment.
export default function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context or permission): the value stays selectable.
    }
  }

  return (
    <button type="button" className={copied ? "copy-btn is-copied" : "copy-btn"} onClick={copy}
            aria-label={`${t.provenance.copy} ${value}`} title={copied ? t.provenance.copied : t.provenance.copy}>
      <Icon name={copied ? "check" : "file"} />
      <span>{copied ? t.provenance.copied : t.provenance.copy}</span>
    </button>
  );
}
