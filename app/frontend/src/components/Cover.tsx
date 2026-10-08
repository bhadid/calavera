import { useState } from "react";
import { Skull } from "./Skull";

/** Album artwork with a neutral placeholder while unknown or if it fails to load. */
export function Cover({ src, size = 64, round = false }: { src: string; size?: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: round ? "50%" : undefined };
  if (!src || failed) {
    return (
      <div className="cover cover-empty" style={style}>
        <Skull size={Math.round(size * 0.45)} />
      </div>
    );
  }
  return <img className="cover" style={style} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
