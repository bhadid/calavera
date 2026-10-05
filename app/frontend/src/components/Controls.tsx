import { useId } from "react";

/** An on/off switch. The visible label is supplied by the caller via `labelledBy`. */
export function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </span>
  );
}

/** A small set of mutually exclusive choices, shown side by side. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={String(option.value)}>
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
