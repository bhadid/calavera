import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon";

/** Back to where the user came from; a directly opened link has no history. */
export function BackButton({ fallback = "/search" }: { fallback?: string }) {
  const navigate = useNavigate();
  return (
    <button className="button button-plain backlink" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(fallback))}>
      <Icon name="back" size={16} /> Back
    </button>
  );
}

/** A page that could not be loaded. */
export function LoadError({ message, fallback }: { message: string; fallback?: string }) {
  return (
    <>
      <BackButton fallback={fallback} />
      <div className="callout callout-bad" role="alert">
        <span className="callout-icon">
          <Icon name="warning" size={20} />
        </span>
        <div>{message}</div>
      </div>
    </>
  );
}
