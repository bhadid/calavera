import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ConfirmProvider } from "./components/Confirm";
import { StoreProvider } from "./lib/store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
