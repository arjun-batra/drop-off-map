import { useRef, useState, type FormEvent } from "react";
import { verifyPassword } from "../api";
import { setClientSessionFlag } from "../sessionFlag";
import "./PasswordGate.css";

interface PasswordGateProps {
  onSuccess: () => void;
}

/** Screen 0 -- Password Gate, docs/ux-spec.md section 3. */
export function PasswordGate({ onSuccess }: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError(null);

    const result = await verifyPassword(password);

    setSubmitting(false);

    if (result.ok) {
      setClientSessionFlag();
      onSuccess();
      return;
    }

    setPassword("");
    setError("Incorrect password. Please try again.");
    inputRef.current?.focus();
  }

  return (
    <div className="app-shell">
      <div className="app-shell__container password-gate">
        <div className="password-gate__icon" aria-hidden="true">
          &#128274;
        </div>
        <h1 className="type-h1">DropSpot</h1>
        <p className="type-body password-gate__copy">This app requires a password to continue.</p>

        <form onSubmit={handleSubmit} noValidate>
          <label className="type-label password-gate__label" htmlFor="password-gate-input">
            Password
          </label>
          <div className={`password-gate__field ${error ? "password-gate__field--error" : ""}`}>
            <input
              id="password-gate-input"
              ref={inputRef}
              className="type-body focus-ring"
              type={showPassword ? "text" : "password"}
              value={password}
              disabled={submitting}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="type-body-small password-gate__toggle focus-ring"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={submitting}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {error && (
            <p className="type-body-small password-gate__error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="type-body-strong password-gate__submit focus-ring"
            disabled={!password || submitting}
          >
            {submitting ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
