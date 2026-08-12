import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PASSWORD_MAX_LENGTH } from "@/lib/passwordPolicy";

/**
 * WO-098B — password input with an accessible Show/Hide control.
 *
 * The toggle only flips the input type: the value is never copied, logged or
 * reported anywhere, and autoComplete is passed straight through so password
 * managers keep their normal semantics.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "new-password",
  describedBy,
  invalid,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  describedBy?: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-charcoal mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          maxLength={PASSWORD_MAX_LENGTH}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="w-full h-12 rounded-control border border-border bg-card pl-4 pr-14 text-base text-charcoal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-control text-charcoal-muted hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Eye aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}

export default PasswordField;
