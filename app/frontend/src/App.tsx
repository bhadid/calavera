import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/Account";
import { AlbumPage } from "./pages/Album";
import { ArtistPage } from "./pages/Artist";
import { ArtistGroupPage } from "./pages/ArtistGroup";
import { QueuePage } from "./pages/Queue";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { SongPage } from "./pages/Song";
import "./styles.css";

// To add a page: create it in pages/, add a <Route> here and, if it belongs
// in the main navigation, an entry in NAV in components/Layout.tsx.
// Search is the start page.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/search" replace />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="album/:id" element={<AlbumPage />} />
        <Route path="song/:id" element={<SongPage />} />
        <Route path="artist/:id" element={<ArtistPage />} />
        <Route path="artist/:id/:group" element={<ArtistGroupPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/search" replace />} />
      </Route>
    </Routes>
  );
}
