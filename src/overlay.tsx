import { createRoot } from "react-dom/client";
import { OverlayApp } from "@/app/OverlayApp";
import "@/index.css";

document.documentElement.classList.add("overlay-root");

createRoot(document.getElementById("root")!).render(<OverlayApp />);
