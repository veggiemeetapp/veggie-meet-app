import { Check, Circle, Info } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/passwordPolicy";

/**
 * WO-098B — member-facing password requirements.
 *
 * Rendered identically on signup and password reset so a member never learns
 * two different sets of rules. Locally checkable rules reflect live state while
 * typing; the breach rule stays informational because only the backend can
 * evaluate it (the password never leaves the device before submit).
 *
 * Accessibility: the list is a plain list referenced via aria-describedby, state
 * is conveyed by icon + text (not colour alone), and it is not a live region so
 * assistive tech is not spammed on every keystroke.
 */
export function PasswordRequirements({
  password,
  id = "password-requirements",
  className,
}: {
  password: string;
  id?: string;
  className?: string;
}) {
  return (
    <div id={id} className={className}>
      <p className="text-sm font-semibold text-charcoal">Password requirements</p>
      <ul className="mt-2 space-y-1.5">
        {PASSWORD_RULES.map((rule) => {
          const state = rule.check(password);
          const met = state === true;
          const Icon = state === null ? Info : met ? Check : Circle;
          return (
            <li key={rule.id} className="flex items-start gap-2 text-sm">
              <Icon
                aria-hidden="true"
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  met ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <span
                className={`min-w-0 break-words ${
                  met ? "text-charcoal" : "text-charcoal-muted"
                }`}
              >
                {rule.label}
                {state !== null && (
                  <span className="sr-only">{met ? " — met" : " — not met yet"}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PasswordRequirements;
