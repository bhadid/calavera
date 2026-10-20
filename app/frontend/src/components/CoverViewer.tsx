import { useRef, useState } from "react";
import type { AlbumDetail } from "../lib/types";
import { Cover } from "./Cover";
import { Icon } from "./Icon";

/**
 * An album's cover that shows itself large over the page when clicked, as
 * Photos does, at the largest size Apple has. The large image comes through
 * Calavera under the name "Artist - Album.jpg", so that right-click "Save
 * image as" suggests that name. It closes with Escape, the close button or a
 * click beside it.
 */
export function CoverViewer({ album, size }: { album: AlbumDetail; size: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The large image is only asked for once someone wants to see it.
  const [opened, setOpened] = useState(false);
  if (!album.artwork) return <Cover src="" size={size} />;

  const name = `${album.artist} - ${album.name}`.replace(/[\\/<>:"|?*]/g, "_").trim();
  const large = `/api/catalog/albums/${album.id}/cover/${encodeURIComponent(name)}.jpg?sf=${album.storefront}`;
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        className="cover-button"
        aria-label="Show cover larger"
        onClick={() => {
          setOpened(true);
          dialog.current?.showModal();
        }}
      >
        <Cover src={album.artwork} size={size} />
      </button>
      {/* A click on the dimmed page around the cover lands on the dialog itself. */}
      <dialog ref={dialog} className="lightbox" aria-label={`Cover of ${album.name}`} onClick={(e) => e.target === e.currentTarget && close()}>
        {opened && (
          // The small cover, already loaded, stands in until the large one is here.
          <img src={large} alt={`Cover of ${album.name}`} style={{ backgroundImage: `url("${album.artwork}")` }} />
        )}
        <button className="lightbox-close" aria-label="Close" onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </dialog>
    </>
  );
}
