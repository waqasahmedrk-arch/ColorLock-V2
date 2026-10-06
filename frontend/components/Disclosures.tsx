import { api } from "@/lib/api";
import Icon from "@/components/Icon";
import { getT } from "@/lib/i18n/server";

// FR-1.4: every results page shows the methodological disclosures.
export default async function Disclosures({ open = false }: { open?: boolean }) {
  const [items, { t }] = await Promise.all([api.disclosures(), getT()]);
  return (
    <details className="disclosures card" open={open}>
      <summary><Icon name="info" className="lead" />{t.disclosures.summary(items.length)}</summary>
      <ol>
        {items.map((d) => (
          <li key={d.id}>
            <strong>{t.data.disclosures[d.id]?.title ?? d.title}</strong>
            <span className="muted">{t.data.disclosures[d.id]?.text ?? d.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
