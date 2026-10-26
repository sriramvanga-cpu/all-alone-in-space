import { createRoot } from "react-dom/client";
import "@fontsource/orbitron/latin-600.css";
import "@fontsource/orbitron/latin-700.css";
import "@fontsource/orbitron/latin-800.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
