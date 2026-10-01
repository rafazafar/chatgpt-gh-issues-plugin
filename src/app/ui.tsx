import type { ComponentChildren } from "preact";
import type { Item, Label, Person } from "../shared/types.ts";
import { cx } from "./util.ts";

export const Icon = {
  issue: <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />,
  closed: <path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0ZM16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />,
  pr: <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z" />,
  draft: <path d="M2 2.75C2 1.784 2.784 1 3.75 1h8.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM5 5h6v1.5H5Zm0 3h4v1.5H5Z" />,
  play: <path d="M4 2.8v10.4a.6.6 0 0 0 .92.5l8.2-5.2a.6.6 0 0 0 0-1L4.92 2.3A.6.6 0 0 0 4 2.8Z" />,
  refresh: <path d="M8 2.5a5.5 5.5 0 0 1 4.9 3H11V7h4V3h-1.5v1.6A7 7 0 0 0 1 8h1.5A5.5 5.5 0 0 1 8 2.5Zm5.5 5.5A5.5 5.5 0 0 1 3.1 10.5H5V9H1v4h1.5v-1.6A7 7 0 0 0 15 8Z" />,
  comment: <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />,
  link: <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" />,
  close: <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />,
  search: <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />,
  check: <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />,
};

export function Svg({ d, size = 16, class: c }: { d: keyof typeof Icon; size?: number; class?: string }) {
  return (
    <svg class={c} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {Icon[d]}
    </svg>
  );
}

export function StateIcon({ item, size = 16 }: { item: Pick<Item, "kind" | "state">; size?: number }) {
  const { kind, state } = item;
  const tone =
    state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : state === "DRAFT" ? "draft" : "open";
  const d = kind === "pr" ? "pr" : kind === "draft" ? "draft" : state === "CLOSED" ? "closed" : "issue";
  return <Svg d={d} size={size} class={`state ${tone}`} />;
}

export function LabelChip({ label }: { label: Label }) {
  const c = `#${label.color}`;
  return (
    <span
      class="label"
      style={{
        background: `color-mix(in srgb, ${c} 20%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 55%, transparent)`,
      }}
    >
      {label.name}
    </span>
  );
}

export function Avatars({ people, max = 3 }: { people: Person[]; max?: number }) {
  if (!people.length) return null;
  return (
    <span class="avatars">
      {people.slice(0, max).map((p) => (
        <img key={p.login} src={p.avatarUrl} alt={p.login} title={p.login} width="20" height="20" onError={(e) => ((e.currentTarget as HTMLElement).style.visibility = "hidden")} />
      ))}
      {people.length > max && <span class="more">+{people.length - max}</span>}
    </span>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      class={cx("check", checked && "on")}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      {checked && <Svg d="check" size={12} />}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} class={cx(o.id === value && "on")} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ComponentChildren; icon?: ComponentChildren }) {
  return (
    <div class="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Skeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="sk-row">
          <i style={{ width: 16 }} />
          <div>
            <i style={{ width: `${55 + ((i * 17) % 35)}%` }} />
            <i style={{ width: `${25 + ((i * 11) % 20)}%`, height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <i class="spinner" role="img" aria-label={label ?? "Loading"} />;
}
